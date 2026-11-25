import { Effect } from "effect";

import { MailProtocolError } from "./errors";
import { SystemLabel, userLabelPath } from "./ids";
import type { AccountId, LabelId, MailboxRole, ThreadId } from "./ids";
import { MailEngineStore } from "./store";
import type { MailboxRecord, ThreadChanges, ThreadLocation } from "./store";
import {
  NO_THREAD_CHANGES,
  mergeThreadChanges,
  rereadCopies,
  syncMailbox,
  toImapMailbox,
} from "./sync";
import type { SyncScope } from "./sync";

/** What the user asked to do with one or more conversations. */
export type ThreadAction =
  | { readonly kind: "deleteForever" }
  | { readonly kind: "moveToInbox" }
  | { readonly kind: "moveToSpam" }
  | {
      readonly kind: "setLabel";
      readonly applied: boolean;
      readonly labelId: LabelId;
    }
  | { readonly kind: "setRead"; readonly read: boolean }
  | { readonly kind: "trash" };

const SEEN_FLAG = "\\Seen";
const FLAGGED_FLAG = "\\Flagged";
const INBOX_PATH = "INBOX";

/** Gmail's own names for the system labels a client may add or remove. */
const GMAIL_LABEL_NAMES = new Map<LabelId, string>([
  [SystemLabel.important, "\\Important"],
  [SystemLabel.inbox, "\\Inbox"],
]);

const hasFlag = (location: ThreadLocation, flag: string): boolean =>
  location.flags.some(
    (candidate) => candidate.toLowerCase() === flag.toLowerCase()
  );

/**
 * The copies one command can name: those of one mailbox, under the
 * UIDVALIDITY their UIDs were cached under, which the command carries.
 */
interface CopyGroup {
  readonly path: string;
  readonly uidValidity: bigint;
  readonly uids: readonly number[];
}

const groupByMailbox = (
  locations: readonly ThreadLocation[]
): readonly CopyGroup[] => {
  const groups = new Map<
    string,
    { readonly path: string; readonly uidValidity: bigint; uids: number[] }
  >();
  for (const { mailboxPath, uid, uidValidity } of locations) {
    const key = `${uidValidity} ${mailboxPath}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { path: mailboxPath, uidValidity, uids: [uid] });
    } else {
      group.uids.push(uid);
    }
  }
  return [...groups.values()];
};

/** One store on a set of copies: an IMAP flag or a Gmail label. */
interface CopyChange {
  readonly flag?: { readonly add: boolean; readonly name: string } | undefined;
  readonly gmailLabel?:
    | { readonly add: boolean; readonly name: string }
    | undefined;
}

/**
 * Catches the cache up with mailboxes a move, copy or expunge touched. The
 * moved copies vanish from one and arrive in the other under new UIDs; the
 * message keeps its id, so its body is not downloaded again.
 */
export const refreshMailboxes = Effect.fn("MailMutations.refreshMailboxes")(
  function* refreshMailboxes(scope: SyncScope, paths: readonly string[]) {
    const store = yield* MailEngineStore;
    const wanted = new Set(paths);
    const records = (yield* store.getMailboxes(scope.accountId)).filter(
      (record) =>
        record.synced &&
        (wanted.has(record.path) ||
          // Gmail files every move into Inbox or out of Spam and Trash
          // through All Mail.
          (scope.dialect.kind === "gmail" && record.role === "all"))
    );
    const results: ThreadChanges[] = [];

    for (const record of records) {
      results.push(yield* syncMailbox(scope, toImapMailbox(record), record));
    }

    return mergeThreadChanges(...results);
  }
);

interface ActionContext {
  readonly locations: readonly ThreadLocation[];
  readonly mailboxes: readonly MailboxRecord[];
  readonly scope: SyncScope;
}

const mailboxWithRole = (
  context: ActionContext,
  role: MailboxRole
): MailboxRecord | undefined =>
  context.mailboxes.find(
    (mailbox) => mailbox.role === role && mailbox.selectable
  );

const requireMailbox = (
  context: ActionContext,
  role: MailboxRole,
  name: string
) => {
  const mailbox = mailboxWithRole(context, role);
  return mailbox === undefined
    ? Effect.fail(
        new MailProtocolError({
          accountId: context.scope.accountId,
          message: `This account has no ${name} folder`,
        })
      )
    : Effect.succeed(mailbox);
};

const roleOf = (context: ActionContext, path: string): MailboxRole =>
  context.mailboxes.find((mailbox) => mailbox.path === path)?.role ?? "none";

/** Copies here are on their way to deletion, so they never keep a message. */
const DISCARDED_ROLES: ReadonlySet<MailboxRole> = new Set(["junk", "trash"]);

const isDiscarded = (context: ActionContext, path: string): boolean =>
  DISCARDED_ROLES.has(roleOf(context, path));

/**
 * The user's own copies: what they sent and their drafts. Spam is a verdict
 * on other people's mail, so these stay in Sent and Drafts, and "Not spam"
 * never moves them into the Inbox.
 */
const isOwnCopy = (location: ThreadLocation): boolean =>
  location.labelIds.includes(SystemLabel.sent) ||
  location.labelIds.includes(SystemLabel.draft);

/** A mailbox a copy can go back to: still there, and not on its way out. */
const isRestorable = (context: ActionContext, path: string): boolean =>
  context.mailboxes.some(
    (mailbox) => mailbox.path === path && mailbox.selectable
  ) && !isDiscarded(context, path);

const labelNotAvailable = (context: ActionContext) =>
  new MailProtocolError({
    accountId: context.scope.accountId,
    message: "This label is no longer available",
  });

/** The cached mailbox a user label stands for, by the dialect's own ids. */
const labelMailbox = (
  context: ActionContext,
  labelId: LabelId
): MailboxRecord | undefined => {
  const label = context.scope.dialect
    .userLabels(context.mailboxes.map(toImapMailbox))
    .find((candidate) => candidate.id === labelId);
  return label === undefined
    ? undefined
    : context.mailboxes.find((mailbox) => mailbox.path === label.path);
};

/**
 * Flag or Gmail-label stores: the server first, then the cached copies as
 * the server holds them afterwards. They are read back, not written as the
 * store was meant to leave them: another client may have changed the same
 * copies at that moment, and a server may answer a store its own way.
 */
const storeOnCopies = Effect.fn("MailMutations.storeOnCopies")(
  function* storeOnCopies(
    context: ActionContext,
    targets: readonly ThreadLocation[],
    change: CopyChange
  ) {
    const results: ThreadChanges[] = [];

    for (const { path, uidValidity, uids } of groupByMailbox(targets)) {
      // Copies are dropped with their mailbox, so each has one cached.
      const mailbox = context.mailboxes.find(
        (candidate) => candidate.path === path
      );
      if (mailbox === undefined) {
        continue;
      }
      if (change.flag !== undefined) {
        yield* context.scope.session.setFlags(
          path,
          uidValidity,
          uids,
          change.flag.add ? "add" : "remove",
          [change.flag.name]
        );
      }
      if (change.gmailLabel !== undefined) {
        yield* context.scope.session.setGmailLabels(
          path,
          uidValidity,
          uids,
          change.gmailLabel.add ? "add" : "remove",
          [change.gmailLabel.name]
        );
      }
      const reread = yield* rereadCopies(
        context.scope,
        toImapMailbox(mailbox),
        uidValidity,
        uids
      );
      results.push(reread.changes);
      if (!reread.complete) {
        // A copy the server did not return has left the mailbox, and reading
        // the mailbox is what finds out which.
        results.push(yield* refreshMailboxes(context.scope, [path]));
      }
    }

    return mergeThreadChanges(...results);
  }
);

/**
 * Moves each group of copies to its destination, then catches up every
 * mailbox involved, once.
 */
const moveCopiesTo = Effect.fn("MailMutations.moveCopiesTo")(
  function* moveCopiesTo(
    context: ActionContext,
    byDestination: ReadonlyMap<string, readonly ThreadLocation[]>
  ) {
    const touched = new Set<string>();
    for (const [destination, targets] of byDestination) {
      const sources = groupByMailbox(
        targets.filter((location) => location.mailboxPath !== destination)
      );
      for (const { path, uidValidity, uids } of sources) {
        yield* context.scope.session.move(path, uidValidity, uids, destination);
        touched.add(path);
      }
      touched.add(destination);
    }
    return yield* refreshMailboxes(context.scope, [...touched]);
  }
);

/** Moves copies to `destination`, then catches up both ends. */
const moveCopies = (
  context: ActionContext,
  targets: readonly ThreadLocation[],
  destination: string
) => moveCopiesTo(context, new Map([[destination, targets]]));

const setRead = (context: ActionContext, read: boolean) =>
  storeOnCopies(
    context,
    context.locations.filter(
      (location) => hasFlag(location, SEEN_FLAG) !== read
    ),
    { flag: { add: read, name: SEEN_FLAG } }
  );

const setStar = (context: ActionContext, applied: boolean) =>
  storeOnCopies(
    context,
    context.locations.filter(
      (location) => hasFlag(location, FLAGGED_FLAG) !== applied
    ),
    { flag: { add: applied, name: FLAGGED_FLAG } }
  );

/** Gmail labels are stored on the All Mail copy, by their Gmail name. */
const setGmailLabel = (
  context: ActionContext,
  labelId: LabelId,
  gmailLabel: string,
  applied: boolean
) =>
  storeOnCopies(
    context,
    context.locations.filter(
      (location) =>
        roleOf(context, location.mailboxPath) === "all" &&
        location.labelIds.includes(labelId) !== applied
    ),
    { gmailLabel: { add: applied, name: gmailLabel } }
  );

/**
 * Folders hold the copies a label stands for. Adding a label copies the
 * message there. Removing one deletes the folder's copy only when a live copy
 * remains elsewhere, and otherwise moves the message to Archive so it is
 * never lost.
 */
const setFolderLabel = Effect.fn("MailMutations.setFolderLabel")(
  function* setFolderLabel(
    context: ActionContext,
    folder: MailboxRecord,
    applied: boolean
  ) {
    const store = yield* MailEngineStore;

    if (applied) {
      const firstCopies = new Map<string, ThreadLocation>();
      const filed = new Set(
        context.locations
          .filter((location) => location.mailboxPath === folder.path)
          .map((location) => location.messageId)
      );
      // A copy in Trash or Spam is never the one filed: that would bring a
      // discarded message back, in a conversation that has other mail.
      for (const location of context.locations) {
        if (
          !filed.has(location.messageId) &&
          !firstCopies.has(location.messageId) &&
          !isDiscarded(context, location.mailboxPath)
        ) {
          firstCopies.set(location.messageId, location);
        }
      }
      for (const { path, uidValidity, uids } of groupByMailbox([
        ...firstCopies.values(),
      ])) {
        yield* context.scope.session.copy(path, uidValidity, uids, folder.path);
      }
      return yield* refreshMailboxes(context.scope, [folder.path]);
    }

    // Whether another copy survives decides between deleting and archiving,
    // so the mailboxes holding the copies are caught up first.
    const caughtUp = yield* refreshMailboxes(context.scope, [
      ...new Set(context.locations.map((location) => location.mailboxPath)),
    ]);
    const locations = yield* store.threadLocations(context.scope.accountId, [
      ...new Set(context.locations.map((location) => location.threadId)),
    ]);
    const kept = new Set(
      locations
        .filter(
          (location) =>
            location.mailboxPath !== folder.path &&
            !isDiscarded(context, location.mailboxPath)
        )
        .map((location) => location.messageId)
    );
    const inFolder = locations.filter(
      (location) => location.mailboxPath === folder.path
    );
    const redundant = inFolder.filter((location) =>
      kept.has(location.messageId)
    );
    const onlyCopies = inFolder.filter(
      (location) => !kept.has(location.messageId)
    );
    const archive =
      onlyCopies.length === 0
        ? undefined
        : yield* requireMailbox(context, "archive", "Archive");

    for (const { path, uidValidity, uids } of groupByMailbox(redundant)) {
      yield* context.scope.session.expunge(path, uidValidity, uids);
    }
    if (archive !== undefined) {
      for (const { path, uidValidity, uids } of groupByMailbox(onlyCopies)) {
        yield* context.scope.session.move(
          path,
          uidValidity,
          uids,
          archive.path
        );
      }
    }

    return mergeThreadChanges(
      caughtUp,
      yield* refreshMailboxes(context.scope, [
        folder.path,
        ...(archive === undefined ? [] : [archive.path]),
      ])
    );
  }
);

/**
 * Generic archive and unarchive move copies between Inbox and Archive. Only
 * Archive's copies come back: a conversation filed only in a folder or Sent
 * has none, and saying so beats reporting a move that never happened.
 */
const setFolderInbox = Effect.fn("MailMutations.setFolderInbox")(
  function* setFolderInbox(context: ActionContext, applied: boolean) {
    if (!applied) {
      const archive = yield* requireMailbox(context, "archive", "Archive");
      return yield* moveCopies(
        context,
        context.locations.filter(
          (location) => roleOf(context, location.mailboxPath) === "inbox"
        ),
        archive.path
      );
    }

    const archived = context.locations.filter(
      (location) => roleOf(context, location.mailboxPath) === "archive"
    );
    if (archived.length === 0) {
      return yield* new MailProtocolError({
        accountId: context.scope.accountId,
        message: "Only archived mail can be moved to the Inbox",
      });
    }
    return yield* moveCopies(context, archived, INBOX_PATH);
  }
);

const setLabel = (
  context: ActionContext,
  labelId: LabelId,
  applied: boolean
) => {
  const isGmail = context.scope.dialect.kind === "gmail";

  if (userLabelPath(labelId) !== undefined) {
    const mailbox = labelMailbox(context, labelId);
    if (mailbox === undefined) {
      return Effect.fail(labelNotAvailable(context));
    }
    return isGmail
      ? setGmailLabel(context, labelId, mailbox.path, applied)
      : setFolderLabel(context, mailbox, applied);
  }

  if (labelId === SystemLabel.starred) {
    return setStar(context, applied);
  }
  if (labelId === SystemLabel.unread) {
    return setRead(context, !applied);
  }
  const gmailLabel = GMAIL_LABEL_NAMES.get(labelId);
  if (isGmail && gmailLabel !== undefined) {
    return setGmailLabel(context, labelId, gmailLabel, applied);
  }
  if (!isGmail && labelId === SystemLabel.inbox) {
    return setFolderInbox(context, applied);
  }
  return Effect.fail(labelNotAvailable(context));
};

const trash = Effect.fn("MailMutations.trash")(function* trash(
  context: ActionContext
) {
  const destination = yield* requireMailbox(context, "trash", "Trash");
  const targets = context.locations.filter(
    (location) => roleOf(context, location.mailboxPath) !== "trash"
  );
  // Outside Gmail a copy in Trash forgets its folder, so where the user's own
  // copies were is remembered first, for Undo to put them back.
  if (context.scope.dialect.kind === "generic") {
    const store = yield* MailEngineStore;
    yield* store.rememberCopyOrigins(
      context.scope.accountId,
      [...new Set(targets.map((location) => location.messageId))],
      targets.filter(isOwnCopy).map(({ mailboxPath, messageId }) => ({
        mailboxPath,
        messageId,
      }))
    );
  }
  return yield* moveCopies(context, targets, destination.path);
});

const moveToSpam = Effect.fn("MailMutations.moveToSpam")(function* moveToSpam(
  context: ActionContext
) {
  const destination = yield* requireMailbox(context, "junk", "Spam");
  const outside = context.locations.filter(
    (location) => roleOf(context, location.mailboxPath) !== "junk"
  );
  if (outside.length === 0) {
    return NO_THREAD_CHANGES;
  }
  const received = outside.filter((location) => !isOwnCopy(location));
  if (received.length === 0) {
    return yield* new MailProtocolError({
      accountId: context.scope.accountId,
      message: "Only your own messages are in this conversation",
    });
  }
  return yield* moveCopies(context, received, destination.path);
});

/**
 * Out of Spam or Trash and back into the Inbox. Outside Gmail, the user's own
 * copies that Trash took return to the Sent or Drafts mailbox they came from,
 * one remembered origin per copy, while it is still there. Gmail's restore
 * is unchanged: it was verified only into the Inbox.
 */
const moveToInbox = Effect.fn("MailMutations.moveToInbox")(
  function* moveToInbox(context: ActionContext) {
    const discarded = context.locations.filter((location) =>
      isDiscarded(context, location.mailboxPath)
    );
    if (context.scope.dialect.kind === "gmail") {
      return yield* moveCopies(context, discarded, INBOX_PATH);
    }

    const store = yield* MailEngineStore;
    const messageIds = [
      ...new Set(discarded.map((location) => location.messageId)),
    ];
    const origins = yield* store.copyOrigins(
      context.scope.accountId,
      messageIds
    );
    const unclaimed = new Map(
      [...origins].map(([messageId, paths]) => [messageId, [...paths]])
    );
    const byDestination = new Map<string, ThreadLocation[]>();
    for (const location of discarded) {
      const origin = unclaimed.get(location.messageId)?.shift();
      const destination =
        origin !== undefined && isRestorable(context, origin)
          ? origin
          : INBOX_PATH;
      byDestination.set(destination, [
        ...(byDestination.get(destination) ?? []),
        location,
      ]);
    }

    const changes = yield* moveCopiesTo(context, byDestination);
    yield* store.forgetCopyOrigins(context.scope.accountId, messageIds);
    return changes;
  }
);

/**
 * Permanent deletion of the copies in Spam or Trash, as Gmail's "Delete
 * forever" does: messages of the conversation kept elsewhere stay.
 */
const deleteForever = Effect.fn("MailMutations.deleteForever")(
  function* deleteForever(context: ActionContext) {
    const discarded = context.locations.filter((location) =>
      isDiscarded(context, location.mailboxPath)
    );
    if (discarded.length === 0) {
      return yield* new MailProtocolError({
        accountId: context.scope.accountId,
        message:
          "Only conversations in Spam or Trash can be permanently deleted",
      });
    }

    const store = yield* MailEngineStore;
    const groups = groupByMailbox(discarded);
    for (const { path, uidValidity, uids } of groups) {
      yield* context.scope.session.expunge(path, uidValidity, uids);
    }
    const refreshed = yield* refreshMailboxes(context.scope, [
      ...new Set(groups.map((group) => group.path)),
    ]);
    // The expunged messages are gone for good, even while a skeleton walk
    // keeps the general clean-up waiting.
    const deleted = yield* store.removeMessagesWithoutCopies(
      context.scope.accountId,
      [...new Set(discarded.map((location) => location.messageId))]
    );
    return mergeThreadChanges(refreshed, deleted);
  }
);

/**
 * Applies an action to every cached copy of the given conversations, on the
 * server first, so a refused change leaves the cache as the server has it.
 * The cache then takes what the server holds: a flag or label change reads
 * its copies back, and a move, copy or expunge reads the mailboxes it
 * touched.
 */
export const applyThreadAction = Effect.fn("MailMutations.applyThreadAction")(
  function* applyThreadAction(
    scope: SyncScope,
    threadIds: readonly ThreadId[],
    action: ThreadAction
  ) {
    const store = yield* MailEngineStore;
    const context: ActionContext = {
      locations: yield* store.threadLocations(scope.accountId, threadIds),
      mailboxes: yield* store.getMailboxes(scope.accountId),
      scope,
    };

    if (context.locations.length === 0) {
      return NO_THREAD_CHANGES;
    }

    switch (action.kind) {
      case "deleteForever": {
        return yield* deleteForever(context);
      }
      case "moveToInbox": {
        return yield* moveToInbox(context);
      }
      case "moveToSpam": {
        return yield* moveToSpam(context);
      }
      case "setLabel": {
        return yield* setLabel(context, action.labelId, action.applied);
      }
      case "setRead": {
        return yield* setRead(context, action.read);
      }
      case "trash": {
        return yield* trash(context);
      }
      default: {
        return action satisfies never;
      }
    }
  }
);

/**
 * Splits conversations for Report spam by what the cache holds. One whose
 * every copy is the user's own has nothing to report, and Report spam refuses
 * it; across a selection it is set apart so it fails alone instead of riding
 * along, unchanged, with the others in its round. One without a cached copy
 * stays with the rest, where the action leaves it as it is.
 */
export const partitionReportableThreads = Effect.fn(
  "MailMutations.partitionReportableThreads"
)(function* partitionReportableThreads(
  accountId: AccountId,
  threadIds: readonly ThreadId[]
) {
  const store = yield* MailEngineStore;
  const locations = yield* store.threadLocations(accountId, threadIds);
  const cached = new Set(locations.map((location) => location.threadId));
  const received = new Set(
    locations
      .filter((location) => !isOwnCopy(location))
      .map((location) => location.threadId)
  );
  const isOwnOnly = (threadId: ThreadId): boolean =>
    cached.has(threadId) && !received.has(threadId);

  return {
    ownOnly: threadIds.filter(isOwnOnly),
    reportable: threadIds.filter((threadId) => !isOwnOnly(threadId)),
  };
});

/** Marks every copy of a conversation's messages read or unread. */
export const setThreadRead = (
  scope: SyncScope,
  threadId: ThreadId,
  read: boolean
) => applyThreadAction(scope, [threadId], { kind: "setRead", read });
