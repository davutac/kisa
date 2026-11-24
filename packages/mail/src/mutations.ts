import { Effect } from "effect";

import { MailProtocolError } from "./errors";
import { SystemLabel, userLabelPath } from "./ids";
import type { LabelId, MailboxRole, ThreadId } from "./ids";
import { MailEngineStore } from "./store";
import type {
  LocationChange,
  MailboxRecord,
  ThreadChanges,
  ThreadLocation,
} from "./store";
import {
  NO_THREAD_CHANGES,
  mergeThreadChanges,
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

const groupByMailbox = (
  locations: readonly ThreadLocation[]
): ReadonlyMap<string, readonly ThreadLocation[]> => {
  const groups = new Map<string, ThreadLocation[]>();
  for (const location of locations) {
    groups.set(location.mailboxPath, [
      ...(groups.get(location.mailboxPath) ?? []),
      location,
    ]);
  }
  return groups;
};

const uidsOf = (locations: readonly ThreadLocation[]): readonly number[] =>
  locations.map((location) => location.uid);

/**
 * One store on a set of copies: an IMAP flag or a Gmail label on the server,
 * and the label it gives the message in the cache. They can point opposite
 * ways: adding `\Seen` removes `UNREAD`.
 */
interface CopyChange {
  readonly flag?: { readonly add: boolean; readonly name: string } | undefined;
  readonly gmailLabel?:
    | { readonly add: boolean; readonly name: string }
    | undefined;
  readonly label: { readonly add: boolean; readonly id: LabelId };
}

const withFlag = (
  flags: readonly string[],
  flag: CopyChange["flag"]
): readonly string[] => {
  if (flag === undefined) {
    return flags;
  }
  const others = flags.filter(
    (candidate) => candidate.toLowerCase() !== flag.name.toLowerCase()
  );
  return flag.add ? [...others, flag.name] : others;
};

/** A copy's new flags and labels after a store. */
const toggled = (
  location: ThreadLocation,
  change: CopyChange
): LocationChange => {
  const others = location.labelIds.filter((label) => label !== change.label.id);
  return {
    flags: withFlag(location.flags, change.flag),
    labelIds: change.label.add ? [...others, change.label.id] : others,
    uid: location.uid,
  };
};

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

/** Flag or Gmail-label stores: the server first, then the cached copies. */
const storeOnCopies = Effect.fn("MailMutations.storeOnCopies")(
  function* storeOnCopies(
    context: ActionContext,
    targets: readonly ThreadLocation[],
    change: CopyChange
  ) {
    const store = yield* MailEngineStore;
    const results: ThreadChanges[] = [];

    for (const [path, locations] of groupByMailbox(targets)) {
      if (change.flag !== undefined) {
        yield* context.scope.session.setFlags(
          path,
          uidsOf(locations),
          change.flag.add ? "add" : "remove",
          [change.flag.name]
        );
      }
      if (change.gmailLabel !== undefined) {
        yield* context.scope.session.setGmailLabels(
          path,
          uidsOf(locations),
          change.gmailLabel.add ? "add" : "remove",
          [change.gmailLabel.name]
        );
      }
      results.push(
        yield* store.applyLocationChanges(
          context.scope.accountId,
          path,
          locations.map((location) => toggled(location, change)),
          {}
        )
      );
    }

    return mergeThreadChanges(...results);
  }
);

/** Moves copies to `destination`, then catches up both ends. */
const moveCopies = Effect.fn("MailMutations.moveCopies")(function* moveCopies(
  context: ActionContext,
  targets: readonly ThreadLocation[],
  destination: string
) {
  const sources = groupByMailbox(
    targets.filter((location) => location.mailboxPath !== destination)
  );
  for (const [path, locations] of sources) {
    yield* context.scope.session.move(path, uidsOf(locations), destination);
  }
  return yield* refreshMailboxes(context.scope, [
    ...sources.keys(),
    destination,
  ]);
});

const setRead = (context: ActionContext, read: boolean) =>
  storeOnCopies(
    context,
    context.locations.filter(
      (location) => hasFlag(location, SEEN_FLAG) !== read
    ),
    {
      flag: { add: read, name: SEEN_FLAG },
      label: { add: !read, id: SystemLabel.unread },
    }
  );

const setStar = (context: ActionContext, applied: boolean) =>
  storeOnCopies(
    context,
    context.locations.filter(
      (location) => hasFlag(location, FLAGGED_FLAG) !== applied
    ),
    {
      flag: { add: applied, name: FLAGGED_FLAG },
      label: { add: applied, id: SystemLabel.starred },
    }
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
    {
      gmailLabel: { add: applied, name: gmailLabel },
      label: { add: applied, id: labelId },
    }
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
      for (const location of context.locations) {
        if (
          !filed.has(location.messageId) &&
          !firstCopies.has(location.messageId)
        ) {
          firstCopies.set(location.messageId, location);
        }
      }
      for (const [path, locations] of groupByMailbox([
        ...firstCopies.values(),
      ])) {
        yield* context.scope.session.copy(path, uidsOf(locations), folder.path);
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

    if (redundant.length > 0) {
      yield* context.scope.session.expunge(folder.path, uidsOf(redundant));
    }
    if (archive !== undefined) {
      yield* context.scope.session.move(
        folder.path,
        uidsOf(onlyCopies),
        archive.path
      );
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

/** Generic archive and unarchive move copies between Inbox and Archive. */
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

    return yield* moveCopies(
      context,
      context.locations.filter(
        (location) => roleOf(context, location.mailboxPath) === "archive"
      ),
      INBOX_PATH
    );
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
  return yield* moveCopies(
    context,
    context.locations.filter(
      (location) => roleOf(context, location.mailboxPath) !== "trash"
    ),
    destination.path
  );
});

const moveToSpam = Effect.fn("MailMutations.moveToSpam")(function* moveToSpam(
  context: ActionContext
) {
  const destination = yield* requireMailbox(context, "junk", "Spam");
  return yield* moveCopies(
    context,
    context.locations.filter(
      (location) => roleOf(context, location.mailboxPath) !== "junk"
    ),
    destination.path
  );
});

/** Out of Spam or Trash and back into the Inbox. */
const moveToInbox = (context: ActionContext) =>
  moveCopies(
    context,
    context.locations.filter((location) => {
      const role = roleOf(context, location.mailboxPath);
      return role === "junk" || role === "trash";
    }),
    INBOX_PATH
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
    for (const [path, locations] of groups) {
      yield* context.scope.session.expunge(path, uidsOf(locations));
    }
    const refreshed = yield* refreshMailboxes(context.scope, [
      ...groups.keys(),
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
 * server first and then in the cache, so a refused change leaves the cache
 * as the server has it.
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

/** Marks every copy of a conversation's messages read or unread. */
export const setThreadRead = (
  scope: SyncScope,
  threadId: ThreadId,
  read: boolean
) => applyThreadAction(scope, [threadId], { kind: "setRead", read });
