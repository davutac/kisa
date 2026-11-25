import { Effect } from "effect";

import { MailProtocolError } from "./errors";
import { userLabelId } from "./ids";
import type { LabelId } from "./ids";
import { refreshMailboxes } from "./mutations";
import { MailEngineStore } from "./store";
import type { MailboxRecord } from "./store";
import {
  discoverMailboxes,
  mergeThreadChanges,
  startRelabel,
  toImapMailbox,
} from "./sync";
import type { SyncScope } from "./sync";

/** Names that would read as, or collide with, a system mailbox. */
const RESERVED_NAMES: ReadonlySet<string> = new Set([
  "[gmail]",
  "[google mail]",
  "all mail",
  "chats",
  "draft",
  "drafts",
  "important",
  "inbox",
  "sent",
  "spam",
  "starred",
  "trash",
  "unread",
]);

const MAX_NAME_LENGTH = 200;
// oxlint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/u;

/**
 * A label name as the user typed it, with `/` nesting, turned into its
 * mailbox path. `undefined` when the server could not hold it as typed.
 */
export const toLabelPath = (
  name: string,
  delimiter: string
): { readonly name: string; readonly path: string } | undefined => {
  const segments = name.split("/").map((segment) => segment.trim());
  const [first = ""] = segments;
  const separator = delimiter.length === 0 ? "/" : delimiter;

  if (
    name.length > MAX_NAME_LENGTH ||
    CONTROL_CHARACTERS.test(name) ||
    segments.some((segment) => segment.length === 0) ||
    RESERVED_NAMES.has(first.toLowerCase()) ||
    (separator !== "/" &&
      segments.some((segment) => segment.includes(separator)))
  ) {
    return undefined;
  }

  return { name: segments.join("/"), path: segments.join(separator) };
};

export interface LabelResult {
  readonly id: LabelId;
  readonly name: string;
}

const failWith = (scope: SyncScope, message: string) =>
  Effect.fail(new MailProtocolError({ accountId: scope.accountId, message }));

/** The hierarchy separator new mailboxes get, as the server reports it. */
const delimiterOf = (mailboxes: readonly MailboxRecord[]): string =>
  (
    mailboxes.find((mailbox) => mailbox.path.toUpperCase() === "INBOX") ??
    mailboxes[0]
  )?.delimiter ?? "/";

const pathTaken = (
  mailboxes: readonly MailboxRecord[],
  path: string,
  except?: string
): boolean =>
  mailboxes.some(
    (mailbox) =>
      mailbox.path !== except &&
      mailbox.path.toLowerCase() === path.toLowerCase()
  );

/** The user label behind `labelId`, resolved from the cached mailbox list. */
const findLabel = Effect.fn("MailLabels.findLabel")(function* findLabel(
  scope: SyncScope,
  labelId: LabelId
) {
  const store = yield* MailEngineStore;
  const mailboxes = yield* store.getMailboxes(scope.accountId);
  const label = scope.dialect
    .userLabels(mailboxes.map(toImapMailbox))
    .find((candidate) => candidate.id === labelId);
  const mailbox =
    label === undefined
      ? undefined
      : mailboxes.find((candidate) => candidate.path === label.path);

  if (label === undefined || mailbox === undefined) {
    return yield* failWith(scope, "This label no longer exists");
  }

  return { label, mailbox, mailboxes };
});

export const createLabel = Effect.fn("MailLabels.createLabel")(
  function* createLabel(scope: SyncScope, name: string) {
    const store = yield* MailEngineStore;
    const mailboxes = yield* store.getMailboxes(scope.accountId);
    const target = toLabelPath(name, delimiterOf(mailboxes));

    if (target === undefined) {
      return yield* failWith(scope, "That label name can't be used");
    }
    if (pathTaken(mailboxes, target.path)) {
      return yield* failWith(scope, "A label with this name already exists");
    }

    yield* scope.session.createMailbox(target.path);
    const discovered = yield* discoverMailboxes(scope);
    // A folder is read from its first message on, so mail filed into it
    // right away is picked up by the next refresh rather than the walk.
    const started =
      scope.dialect.kind === "gmail"
        ? discovered.changes
        : mergeThreadChanges(
            discovered.changes,
            yield* refreshMailboxes(scope, [target.path])
          );

    return {
      changes: started,
      label: {
        id: userLabelId(target.name),
        name: target.name,
      } satisfies LabelResult,
    };
  }
);

/**
 * Renames on the server, then moves what is cached to the new name, so the
 * label keeps its colour and its mail is not walked again. That move is by
 * rule, so the server is read to confirm it. A folder is read where it is
 * now: a server that renumbered it has it walked again. Gmail gives the new
 * label to the mail under the old one without reporting a change to that
 * mail, so the labels of cached copies are read again in the background.
 */
export const renameLabel = Effect.fn("MailLabels.renameLabel")(
  function* renameLabel(scope: SyncScope, labelId: LabelId, name: string) {
    const store = yield* MailEngineStore;
    const { label, mailbox, mailboxes } = yield* findLabel(scope, labelId);
    const target = toLabelPath(name, mailbox.delimiter);

    if (target === undefined) {
      return yield* failWith(scope, "That label name can't be used");
    }
    if (target.path === label.path) {
      return {
        changes: { changed: [], removed: [] },
        label: { id: label.id, name: label.name } satisfies LabelResult,
      };
    }
    if (pathTaken(mailboxes, target.path, label.path)) {
      return yield* failWith(scope, "A label with this name already exists");
    }

    const to = { id: userLabelId(target.name), path: target.path };
    const isGmail = scope.dialect.kind === "gmail";
    yield* scope.session.renameMailbox(label.path, target.path);
    if (isGmail) {
      // Asked for before the cache is moved, so a rename cut short after
      // this still has its labels read.
      yield* startRelabel(
        scope.accountId,
        mailboxes.filter((candidate) => candidate.synced)
      );
    }
    // Moved before discovery, which would otherwise drop the old mailbox's
    // copies and its colour and walk the new one from scratch.
    const renamed = yield* store.renameLabel(scope.accountId, {
      delimiter: mailbox.delimiter,
      from: { id: label.id, path: label.path },
      to,
    });
    const discovered = yield* discoverMailboxes(scope);
    const separator = mailbox.delimiter.length === 0 ? "/" : mailbox.delimiter;
    const read = isGmail
      ? discovered.changes
      : mergeThreadChanges(
          discovered.changes,
          yield* refreshMailboxes(
            scope,
            discovered.mailboxes
              .map((candidate) => candidate.path)
              .filter(
                (path) =>
                  path === target.path ||
                  path.startsWith(`${target.path}${separator}`)
              )
          )
        );

    return {
      changes: mergeThreadChanges(renamed, read),
      label: { id: to.id, name: target.name } satisfies LabelResult,
    };
  }
);

/**
 * Deleting a Gmail label leaves its mail in All Mail. Deleting a folder
 * deletes what is in it, so its mail moves to Archive first, and the folder
 * is kept if anything is still in it.
 */
export const deleteLabel = Effect.fn("MailLabels.deleteLabel")(
  function* deleteLabel(scope: SyncScope, labelId: LabelId) {
    const { label, mailboxes } = yield* findLabel(scope, labelId);

    if (scope.dialect.kind === "gmail") {
      yield* scope.session.deleteMailbox(label.path);
      // The label comes off cached mail when the server's list no longer
      // has it, which discovery reads: not because its deletion was asked.
      return (yield* discoverMailboxes(scope)).changes;
    }

    const archive = mailboxes.find(
      (mailbox) => mailbox.role === "archive" && mailbox.selectable
    );
    if (archive === undefined) {
      return yield* failWith(
        scope,
        "This account has no Archive folder to keep the label's mail in"
      );
    }

    // The folder's mail is listed and moved under one UIDVALIDITY, the one
    // the server gives now: its UIDs are read here, not taken from the cache.
    const { uidValidity } = yield* scope.session.status(label.path);
    const uids = yield* scope.session.search(label.path, uidValidity, {
      kind: "all",
    });
    if (uids.length > 0) {
      yield* scope.session.move(label.path, uidValidity, uids, archive.path);
    }
    const status = yield* scope.session.status(label.path);
    if (status.messages > 0) {
      return yield* failWith(
        scope,
        "New mail arrived in this folder, so it was kept"
      );
    }

    yield* scope.session.deleteMailbox(label.path);
    // The archived copies are cached before discovery forgets the folder's,
    // so the messages keep their ids and bodies.
    const archived = yield* refreshMailboxes(scope, [archive.path]);
    const discovered = yield* discoverMailboxes(scope);
    return mergeThreadChanges(archived, discovered.changes);
  }
);
