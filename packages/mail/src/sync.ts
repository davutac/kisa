import { Effect } from "effect";

import type { Dialect, MessageIdentity, UserLabel } from "./dialects";
import { MailHiddenError } from "./errors";
import type { MailStoreError, MailTransportError } from "./errors";
import { getHeaderValue, parseHeaderBlock, parseMessageIds } from "./headers";
import type {
  AccountId,
  LabelId,
  MailboxRole,
  MessageId,
  ThreadId,
} from "./ids";
import { planMessageStructure } from "./mime-structure";
import type {
  FetchedMessage,
  ImapMailbox,
  ImapSession,
  MailboxState,
  MessageEnvelope,
} from "./session";
import { MailEngineStore } from "./store";
import type {
  BodyCandidate,
  LocationChange,
  MailAddress,
  MailboxCounts,
  MailboxRecord,
  MessageBodies,
  MessageLocation,
  MessageMetadata,
  ThreadChanges,
} from "./store";
import { decodeTextPart } from "./text-decoding";

/** Messages per skeleton fetch and per transaction. */
export const SKELETON_BATCH_SIZE = 500;
/** Messages per body fetch; bodies are larger, so batches stay small. */
export const BODY_BATCH_SIZE = 25;

/**
 * Without CONDSTORE nothing says which flags changed elsewhere, so a
 * background pass reads them again: the newest cached copies every time, and
 * a slice of the older ones that moves down to the skeleton floor and then
 * starts over. `UID FETCH a:b (UID FLAGS)` reads no message content and
 * answers about 50 bytes a message (Thunderbird reads whole folders this way
 * on such servers), so a pass reads at most 2,500 copies, about 125 KB, per
 * mailbox, and a mailbox of `n` cached copies is read through in
 * `ceil((n - 500) / 2000)` passes.
 */
export const FLAG_HEAD_SIZE = 500;
export const FLAG_SLICE_SIZE = 2000;

/**
 * `\Recent` belongs to the connection that saw a message first, not to the
 * message: a server reports it to one session and not the next, so keeping
 * it would make every pass look like a change.
 */
const messageFlags = (flags: readonly string[]): readonly string[] =>
  flags.filter((flag) => flag.toLowerCase() !== "\\recent");

/**
 * Header fields kept with a body: sender branding reads the receiving
 * server's authentication results, and replies and unsubscribe read the rest.
 * Asking for named fields also bounds what a sender can make Kisa download.
 */
export const BODY_HEADER_FIELDS = [
  "authentication-results",
  "bimi-selector",
  "in-reply-to",
  "list-id",
  "list-unsubscribe",
  "list-unsubscribe-post",
  "message-id",
  "references",
  "reply-to",
] as const;

/**
 * What an account's passes remember about drift between them, for one run
 * of the app. Without it a pass does not check for drift.
 */
export interface DriftMemory {
  /** Mailboxes whose flags are being read again because of drift. */
  readonly rereading: Set<string>;
  /**
   * Counts a finished repair left disagreeing with a server that had not
   * changed, as `kind path`. Such a count is the server's own arithmetic (an
   * unread count that is not exact, a message Kisa cannot identify), and
   * comparing it again would repair the same mailbox on every pass.
   */
  readonly unreconciled: Set<string>;
}

export const makeDriftMemory = (): DriftMemory => ({
  rereading: new Set(),
  unreconciled: new Set(),
});

export interface SyncScope {
  readonly accountId: AccountId;
  readonly dialect: Dialect;
  /** Set by the background pass; see `checkDrift`. */
  readonly drift?: DriftMemory | undefined;
  /**
   * Told what a full pass's discovery saved as soon as it is saved, so the
   * caller can announce it even if a later step of the pass fails: the next
   * pass finds no difference to report again.
   */
  readonly discovered?: (discovery: {
    readonly changes: ThreadChanges;
    readonly labelsChanged: boolean;
  }) => Effect.Effect<void>;
  /**
   * Runs one step of a full pass that writes cached copies, so the caller can
   * keep other writers out for that step only, not for the whole pass.
   */
  readonly exclusive?: <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>;
  /**
   * Given what a pass or a refresh had saved when it failed. Its failure
   * takes its result with it while the mail stays cached, so the next pass
   * finds nothing new there to report: this is the one moment that mail can
   * be shown and announced. Not called when the work is interrupted, as it is
   * for an account being disconnected.
   */
  readonly salvage?: (saved: ThreadChanges) => Effect.Effect<void>;
  readonly session: ImapSession;
}

export type SyncError = MailHiddenError | MailStoreError | MailTransportError;

export const NO_THREAD_CHANGES: ThreadChanges = { changed: [], removed: [] };

export const mergeThreadChanges = (
  ...all: readonly ThreadChanges[]
): ThreadChanges => {
  const removed = new Set<ThreadId>(all.flatMap((changes) => changes.removed));
  const changed = new Set<ThreadId>(
    all.flatMap((changes) => changes.changed).filter((id) => !removed.has(id))
  );
  const arrived = new Set(all.flatMap((changes) => changes.arrived ?? []));
  const merged: ThreadChanges = {
    changed: [...changed],
    removed: [...removed],
  };
  return arrived.size === 0 ? merged : { ...merged, arrived: [...arrived] };
};

/** The same changes without new-mail arrivals, for writes of old mail. */
const withoutArrivals = ({
  changed,
  removed,
}: ThreadChanges): ThreadChanges => ({
  changed,
  removed,
});

/**
 * Hands what steps had saved to `scope.salvage` when they fail. `saved` is
 * read at that moment, so it holds whatever the steps added before failing.
 */
export const salvaging =
  (scope: SyncScope, saved: readonly ThreadChanges[]) =>
  <A, E, R>(steps: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.tapError(steps, () => {
      const changes = mergeThreadChanges(...saved);
      return scope.salvage === undefined ||
        (changes.changed.length === 0 && changes.removed.length === 0)
        ? Effect.void
        : scope.salvage(changes);
    });

const MAILBOX_PRIORITY = {
  all: 0,
  archive: 3,
  drafts: 2,
  flagged: 4,
  important: 4,
  inbox: 0,
  junk: 5,
  none: 3,
  sent: 1,
  trash: 6,
} satisfies Record<MailboxRole, number>;

/** Inbox and All Mail first, Spam and Trash last. */
export const byMailboxPriority = (
  left: { readonly path: string; readonly role: MailboxRole },
  right: { readonly path: string; readonly role: MailboxRole }
): number =>
  MAILBOX_PRIORITY[left.role] - MAILBOX_PRIORITY[right.role] ||
  left.path.localeCompare(right.path);

const chunk = <A>(items: readonly A[], size: number): readonly A[][] => {
  const chunks: A[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const groupBy = <A>(
  items: readonly A[],
  key: (item: A) => string
): ReadonlyMap<string, readonly A[]> => {
  const groups = new Map<string, A[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group === undefined) {
      groups.set(key(item), [item]);
    } else {
      group.push(item);
    }
  }
  return groups;
};

const toAddressList = (
  addresses: readonly { readonly address?: string | undefined }[] | undefined
): readonly string[] =>
  (addresses ?? []).flatMap((entry) => {
    const address = entry.address?.trim();
    return address === undefined || address.length === 0 ? [] : [address];
  });

const EMPTY_ENVELOPE: MessageEnvelope = {
  bcc: [],
  cc: [],
  from: [],
  replyTo: [],
  sender: [],
  to: [],
};

const toSender = (envelope: MessageEnvelope): MailAddress => {
  const [sender] = envelope.from.length > 0 ? envelope.from : envelope.sender;
  const name = sender?.name?.trim();

  return {
    address: sender?.address?.trim() ?? "",
    name: name === undefined || name.length === 0 ? undefined : name,
  };
};

export const toMessageMetadata = (
  message: FetchedMessage,
  identity: MessageIdentity
): MessageMetadata => {
  const { envelope = EMPTY_ENVELOPE } = message;
  const headers =
    message.headers === undefined ? [] : parseHeaderBlock(message.headers);
  const [firstReference] = parseMessageIds(
    getHeaderValue(headers, "references")
  );
  const [inReplyTo] = parseMessageIds(envelope.inReplyTo);
  const [rfc822MessageId] = parseMessageIds(envelope.messageId);
  const [replyTo] = toAddressList(envelope.replyTo);

  return {
    bcc: toAddressList(envelope.bcc),
    cc: toAddressList(envelope.cc),
    firstReference,
    from: toSender(envelope),
    inReplyTo,
    messageId: identity.messageId,
    receivedAt: message.internalDate ?? envelope.date ?? 0,
    replyTo,
    rfc822MessageId,
    sentAt: envelope.date,
    size: message.size ?? 0,
    subject: envelope.subject ?? "",
    threadId: identity.threadId,
    to: toAddressList(envelope.to),
  };
};

interface IdentifiedMessage {
  readonly identity: MessageIdentity;
  readonly message: FetchedMessage;
}

const identifyAll = (
  dialect: Dialect,
  messages: readonly FetchedMessage[]
): readonly IdentifiedMessage[] =>
  messages.flatMap((message) => {
    const identity = dialect.identify(message);
    return identity === undefined ? [] : [{ identity, message }];
  });

const toLocation = (
  dialect: Dialect,
  mailbox: ImapMailbox,
  { identity, message }: IdentifiedMessage
): MessageLocation => ({
  flags: messageFlags(message.flags),
  labelIds: dialect.locationLabels(message, mailbox),
  messageId: identity.messageId,
  modseq: message.modseq,
  uid: message.uid,
});

/** Fresh flags and labels of copies already cached. */
const toLocationChanges = (
  dialect: Dialect,
  mailbox: ImapMailbox,
  messages: readonly FetchedMessage[]
): readonly LocationChange[] =>
  messages.map((message) => ({
    flags: messageFlags(message.flags),
    labelIds: dialect.locationLabels(message, mailbox),
    modseq: message.modseq,
    uid: message.uid,
  }));

/** Flags, and Gmail's labels, which a server changes without new UIDs. */
const changeFields = (dialect: Dialect) => ({
  flags: true,
  gmail: dialect.kind === "gmail",
});

/**
 * Reads the flags and labels of cached copies from the server and caches
 * what it answers: how a change Kisa made itself reaches the cache, so the
 * cache never holds what a command was only meant to do. `complete` is false
 * when the server did not return every copy, which means one has left the
 * mailbox since it was cached.
 */
export const rereadCopies = Effect.fn("MailSync.rereadCopies")(
  function* rereadCopies(
    scope: SyncScope,
    mailbox: ImapMailbox,
    uidValidity: bigint,
    uids: readonly number[]
  ) {
    const store = yield* MailEngineStore;
    const fetched = yield* scope.session.fetch(
      mailbox.path,
      uidValidity,
      { kind: "uids", uids },
      changeFields(scope.dialect)
    );
    const returned = new Set(fetched.map((message) => message.uid));

    return {
      changes: yield* store.applyLocationChanges(
        scope.accountId,
        mailbox.path,
        toLocationChanges(scope.dialect, mailbox, fetched),
        {}
      ),
      complete: uids.every((uid) => returned.has(uid)),
    };
  }
);

/** Fetches skeleton metadata for UIDs and commits it with `progress`. */
const storeSkeleton = Effect.fn("MailSync.storeSkeleton")(
  function* storeSkeleton(
    scope: SyncScope,
    mailbox: ImapMailbox,
    uidValidity: bigint,
    uids: readonly number[],
    progress: { readonly skeletonFloor?: number }
  ) {
    const store = yield* MailEngineStore;
    const fetched = yield* scope.session.fetch(
      mailbox.path,
      uidValidity,
      { kind: "uids", uids },
      scope.dialect.skeletonFields
    );
    const identified = identifyAll(scope.dialect, fetched);

    return yield* store.applyMailboxBatch(scope.accountId, {
      locations: identified.map((entry) =>
        toLocation(scope.dialect, mailbox, entry)
      ),
      messages: identified.map((entry) =>
        toMessageMetadata(entry.message, entry.identity)
      ),
      path: mailbox.path,
      progress,
      uidValidity,
    });
  }
);

// ------------------------------------------------------------ discovery

export const toImapMailbox = (record: MailboxRecord): ImapMailbox => ({
  delimiter: record.delimiter,
  flags: [],
  path: record.path,
  role: record.role,
  selectable: record.selectable,
});

/** User labels in `next` and not in `previous`, by id. */
const labelsMissingFrom = (
  previous: readonly UserLabel[],
  next: readonly UserLabel[]
): readonly LabelId[] => {
  const known = new Set(previous.map((label) => label.id));
  return next.filter((label) => !known.has(label.id)).map((label) => label.id);
};

/**
 * Has `relabelStep` read the labels of these mailboxes' cached copies again,
 * from the newest down. A mailbox with nothing cached has nothing to read.
 */
export const startRelabel = Effect.fn("MailSync.startRelabel")(
  function* startRelabel(
    accountId: AccountId,
    records: readonly MailboxRecord[]
  ) {
    const store = yield* MailEngineStore;
    for (const record of records) {
      if (
        record.uidNext !== undefined &&
        (record.skeletonFloor ?? record.uidNext) < record.uidNext
      ) {
        yield* store.applyLocationChanges(accountId, record.path, [], {
          labelCursor: record.uidNext,
        });
      }
    }
  }
);

/**
 * Saves the server's mailbox list. `labelsChanged` says whether its user
 * labels differ from the cached ones, as when another client added, renamed
 * or deleted a folder, so the label catalog can be announced again.
 *
 * A list the dialect cannot read the account's mail from is not saved: see
 * `Dialect.unreadable`. The cache stays as it is, and the failure says what
 * the user can change.
 *
 * Gmail does not report a label renamed or deleted elsewhere as a change to
 * its messages. A label gone from the list is taken off cached copies at
 * once; when labels also appeared, as a rename looks, the synced mailboxes'
 * labels are read again by `relabelStep`. Both happen before the catalog is
 * saved, so a pass cut short finds the same difference and repeats them.
 */
export const discoverMailboxes = Effect.fn("MailSync.discoverMailboxes")(
  function* discoverMailboxes(scope: SyncScope) {
    const store = yield* MailEngineStore;
    const cached = yield* store.getMailboxes(scope.accountId);
    const listed = yield* scope.session.listMailboxes;
    // Before anything is saved: a list without the mailbox the account's
    // mail is read from says the mail is hidden, not gone. Saved, it would
    // drop that mailbox with every copy cached from it.
    const hidden = scope.dialect.unreadable?.(listed);
    if (hidden !== undefined) {
      return yield* new MailHiddenError({
        accountId: scope.accountId,
        message: hidden,
      });
    }
    const synced = new Set(
      scope.dialect.syncedMailboxes(listed).map((mailbox) => mailbox.path)
    );
    const records: MailboxRecord[] = listed.map((mailbox) => ({
      delimiter: mailbox.delimiter,
      path: mailbox.path,
      role: mailbox.role,
      selectable: mailbox.selectable,
      synced: synced.has(mailbox.path),
    }));
    const cachedLabels = scope.dialect.userLabels(cached.map(toImapMailbox));
    const listedLabels = scope.dialect.userLabels(listed);
    const added = labelsMissingFrom(cachedLabels, listedLabels);
    const removed = labelsMissingFrom(listedLabels, cachedLabels);
    const results: ThreadChanges[] = [];

    if (scope.dialect.kind === "gmail") {
      for (const labelId of removed) {
        results.push(yield* store.removeLabel(scope.accountId, labelId));
      }
      if (removed.length > 0 && added.length > 0) {
        yield* startRelabel(
          scope.accountId,
          cached.filter((record) => synced.has(record.path))
        );
      }
    }

    results.push(
      yield* store.replaceMailboxes(scope.accountId, records, listedLabels)
    );

    return {
      changes: mergeThreadChanges(...results),
      labelsChanged: added.length > 0 || removed.length > 0,
      mailboxes: listed
        .filter((mailbox) => synced.has(mailbox.path))
        .toSorted(byMailboxPriority),
    };
  }
);

/**
 * Reads the labels of one slice of cached copies again, below the label
 * cursor of the first mailbox that has one, and moves the cursor down in the
 * same transaction; past the oldest cached copy the cursor is cleared.
 * Returns `undefined` when no mailbox has a label reread left.
 */
export const relabelStep = Effect.fn("MailSync.relabelStep")(
  function* relabelStep(scope: SyncScope) {
    const store = yield* MailEngineStore;
    const record = (yield* store.getMailboxes(scope.accountId)).find(
      (candidate) => candidate.synced && candidate.labelCursor !== undefined
    );

    if (record?.labelCursor === undefined) {
      return;
    }

    const cursor = record.labelCursor;
    const floor = record.skeletonFloor ?? cursor;
    const { uidValidity } = record;
    // A mailbox without a UIDVALIDITY has nothing cached to read again.
    const start =
      uidValidity !== undefined && floor < cursor
        ? yield* store.uidWindowStart(
            scope.accountId,
            record.path,
            cursor,
            FLAG_SLICE_SIZE
          )
        : undefined;
    const fetched =
      start === undefined || uidValidity === undefined
        ? []
        : yield* scope.session.fetch(
            record.path,
            uidValidity,
            { from: Math.max(start, floor), kind: "range", to: cursor - 1 },
            changeFields(scope.dialect)
          );

    return yield* store.applyLocationChanges(
      scope.accountId,
      record.path,
      toLocationChanges(scope.dialect, toImapMailbox(record), fetched),
      { labelCursor: start ?? null }
    );
  }
);

// ---------------------------------------------------------- incremental

/**
 * Reads the flags of cached copies again on a server without mod-sequences:
 * the newest `FLAG_HEAD_SIZE`, then the next `FLAG_SLICE_SIZE` below the
 * stored cursor, wrapping to the newest once the oldest cached copy was
 * read. Only UIDs the cache has are asked for. The cursor is saved in the
 * transaction that saves the slice, so a pass cut short repeats the slice
 * rather than skipping it, and only copies whose flags differ are written.
 *
 * `newest` reads the newest copies alone and leaves the cursor where it is:
 * the answer to a server saying something in the mailbox changed, which is
 * nearly always recent mail.
 */
const rereadFlags = Effect.fn("MailSync.rereadFlags")(function* rereadFlags(
  scope: SyncScope,
  mailbox: ImapMailbox,
  cached: {
    readonly flagCursor?: number | undefined;
    readonly skeletonFloor?: number | undefined;
    readonly uidNext: number;
    readonly uidValidity: bigint;
  },
  extent: "all" | "newest"
) {
  const store = yield* MailEngineStore;
  const { accountId } = scope;
  const { path } = mailbox;
  const floor = cached.skeletonFloor ?? cached.uidNext;
  const headStart =
    floor < cached.uidNext
      ? yield* store.uidWindowStart(
          accountId,
          path,
          cached.uidNext,
          FLAG_HEAD_SIZE
        )
      : undefined;

  if (headStart === undefined) {
    return NO_THREAD_CHANGES;
  }

  const fields = changeFields(scope.dialect);
  const head = yield* scope.session.fetch(
    path,
    cached.uidValidity,
    { from: Math.max(headStart, floor), kind: "range", to: cached.uidNext - 1 },
    fields
  );
  if (extent === "newest") {
    return yield* store.applyLocationChanges(
      accountId,
      path,
      toLocationChanges(scope.dialect, mailbox, head),
      {}
    );
  }

  let sliceEnd = Math.min(cached.flagCursor ?? headStart, headStart);
  let sliceStart = yield* store.uidWindowStart(
    accountId,
    path,
    sliceEnd,
    FLAG_SLICE_SIZE
  );
  if (sliceStart === undefined && sliceEnd < headStart) {
    // The last slice reached the oldest cached copy: start over.
    sliceEnd = headStart;
    sliceStart = yield* store.uidWindowStart(
      accountId,
      path,
      headStart,
      FLAG_SLICE_SIZE
    );
  }

  const slice =
    sliceStart === undefined
      ? []
      : yield* scope.session.fetch(
          path,
          cached.uidValidity,
          {
            from: Math.max(sliceStart, floor),
            kind: "range",
            to: sliceEnd - 1,
          },
          fields
        );

  return yield* store.applyLocationChanges(
    accountId,
    path,
    toLocationChanges(scope.dialect, mailbox, [...head, ...slice]),
    { flagCursor: sliceStart ?? headStart }
  );
});

// ---------------------------------------------------------------- drift

/** Missing copies fetched per pass, which holds the cache's turn meanwhile. */
const DRIFT_FETCH_LIMIT = SKELETON_BATCH_SIZE;

const isSameState = (first: MailboxState, second: MailboxState): boolean =>
  first.uidValidity === second.uidValidity &&
  first.uidNext === second.uidNext &&
  first.messages === second.messages &&
  first.unseen === second.unseen &&
  first.highestModseq === second.highestModseq;

/**
 * Holds what a mailbox has cached against the server's own counts of its
 * messages and of the unread ones, and repairs a difference. A pass applies
 * what the server says changed; nothing else would notice a copy the cache
 * lost or kept, or a flag it has wrong, since the server sees no change to
 * report. The counts come with the `STATUS` the pass sends anyway.
 *
 * The pass's `STATUS` is older than its fetches, so a difference is acted on
 * only if a second `STATUS` says the server has not moved meanwhile.
 * Otherwise the next pass looks again.
 *
 * - A different number of copies: the server's UIDs are listed once, cached
 *   copies it lacks are dropped, and missing ones are fetched, a batch a
 *   pass. They are old mail the cache lost, so they are not announced.
 * - A different number unread: the flags of every cached copy are read
 *   again by the label reread, a slice a step, between the cycle's other
 *   work, so the cache's turn is never held for a whole mailbox.
 *
 * A count that still disagrees after its repair is not compared again in
 * this run: see `DriftMemory`.
 */
const checkDrift = Effect.fn("MailSync.checkDrift")(function* checkDrift(
  scope: SyncScope,
  mailbox: ImapMailbox,
  status: MailboxState,
  memory: DriftMemory
) {
  const store = yield* MailEngineStore;
  const { accountId, session } = scope;
  const { path } = mailbox;
  const record = (yield* store.getMailboxes(accountId)).find(
    (candidate) => candidate.path === path
  );
  // Counts say nothing until every message is cached, and a reread under
  // way is already the repair.
  if (record?.skeletonFloor !== 1 || record.labelCursor !== undefined) {
    return NO_THREAD_CHANGES;
  }

  const copiesKey = `copies ${path}`;
  const unreadKey = `unread ${path}`;
  const differs = (counts: MailboxCounts) => ({
    copies:
      !memory.unreconciled.has(copiesKey) && counts.copies !== status.messages,
    unread:
      !memory.unreconciled.has(unreadKey) &&
      status.unseen !== undefined &&
      counts.unread !== status.unseen,
  });
  const cached = yield* store.mailboxCounts(accountId, path);
  const drift = differs(cached);
  if (!drift.copies && !drift.unread) {
    memory.rereading.delete(path);
    return NO_THREAD_CHANGES;
  }
  if (!isSameState(status, yield* session.status(path))) {
    return NO_THREAD_CHANGES;
  }
  yield* Effect.logWarning(
    `The mail cache differs from the server in a mailbox (${mailbox.role}): ` +
      `${cached.copies} copies and ${cached.unread} unread cached, ` +
      `${status.messages} and ${status.unseen ?? "unknown"} on the server`
  );

  const results: ThreadChanges[] = [];
  let counts = cached;
  if (drift.copies) {
    const present = new Set(
      yield* session.search(path, status.uidValidity, { kind: "all" })
    );
    const copies = new Set(yield* store.locationUids(accountId, path));
    const extra = [...copies].filter((uid) => !present.has(uid));
    const missing = [...present].filter((uid) => !copies.has(uid));
    if (extra.length > 0) {
      results.push(yield* store.removeLocations(accountId, path, extra));
    }
    if (missing.length > 0) {
      results.push(
        withoutArrivals(
          yield* storeSkeleton(
            scope,
            mailbox,
            status.uidValidity,
            missing.slice(-DRIFT_FETCH_LIMIT),
            {}
          )
        )
      );
    }
    counts = yield* store.mailboxCounts(accountId, path);
    if (counts.copies !== status.messages) {
      // More was missing than a pass fetches, and the next pass goes on. Or
      // the whole listing was applied and the count still differs: a
      // message that cannot be cached, which no repair will change.
      if (missing.length <= DRIFT_FETCH_LIMIT) {
        memory.unreconciled.add(copiesKey);
      }
      // The unread count means nothing while copies are missing.
      return mergeThreadChanges(...results);
    }
  }

  if (!differs(counts).unread) {
    memory.rereading.delete(path);
  } else if (memory.rereading.delete(path)) {
    memory.unreconciled.add(unreadKey);
  } else {
    memory.rereading.add(path);
    results.push(
      yield* store.applyLocationChanges(accountId, path, [], {
        labelCursor: status.uidNext,
      })
    );
  }

  return mergeThreadChanges(...results);
});

/**
 * Brings one mailbox's cached copies up to date: new mail at or above the
 * stored UIDNEXT, flag and label changes, and copies that are gone. Mail
 * below the skeleton floor is left to the walk.
 *
 * With CONDSTORE, changes since the stored mod-sequence are fetched. Without
 * it, `rereadFlags` reads a bounded part of the cache again: `true` for the
 * background pass, `"newest"` for the newest copies alone. A refresh after
 * the user's own change asks for neither: a change to flags reads back the
 * copies it touched.
 *
 * Each step saves what it read before the next asks the server anything, so
 * a failure part way leaves mail cached that the result never mentions: see
 * `SyncScope.salvage`.
 */
export const syncMailbox = Effect.fn("MailSync.syncMailbox")(
  function* syncMailbox(
    scope: SyncScope,
    mailbox: ImapMailbox,
    cached: MailboxRecord | undefined,
    options: {
      /** Check the mailbox for drift afterwards: the background pass only. */
      readonly drift?: DriftMemory | undefined;
      readonly rereadFlags?: boolean | "newest";
      /** The mailbox's `STATUS`, when the caller has just asked for it. */
      readonly status?: MailboxState | undefined;
    } = {}
  ) {
    const store = yield* MailEngineStore;
    const status =
      options.status ?? (yield* scope.session.status(mailbox.path));

    if (
      cached?.uidValidity !== status.uidValidity ||
      cached.uidNext === undefined
    ) {
      // Nothing usable is cached: the walk starts from the newest message.
      return yield* store.resetMailbox(scope.accountId, mailbox.path, {
        highestModseq: status.highestModseq,
        messageCount: status.messages,
        skeletonFloor: status.uidNext,
        uidNext: status.uidNext,
        uidValidity: status.uidValidity,
      });
    }

    const cachedUidNext = cached.uidNext;
    const results: ThreadChanges[] = [];

    yield* Effect.gen(function* catchUp() {
      let arrivals = 0;

      if (status.uidNext > cachedUidNext) {
        // `n:*` always returns the newest message, even below n.
        const newUids = (yield* scope.session.search(
          mailbox.path,
          status.uidValidity,
          { from: cachedUidNext, kind: "uidRange", to: status.uidNext - 1 }
        )).filter((uid) => uid >= cachedUidNext);
        arrivals = newUids.length;

        // A pass cut short after caching new mail saved no progress for it,
        // so the saved count below does not cover those copies. This search
        // lists their range, and a copy it does not return has left the
        // server.
        const listed = new Set(newUids);
        const left = (yield* store.locationUids(
          scope.accountId,
          mailbox.path,
          cachedUidNext
        )).filter((uid) => uid < status.uidNext && !listed.has(uid));
        if (left.length > 0) {
          results.push(
            yield* store.removeLocations(scope.accountId, mailbox.path, left)
          );
        }

        const batches = chunk(newUids, SKELETON_BATCH_SIZE);
        for (const uids of batches) {
          results.push(
            yield* storeSkeleton(scope, mailbox, status.uidValidity, uids, {})
          );
        }
      }

      const floor = cached.skeletonFloor ?? cachedUidNext;
      if (status.highestModseq === undefined) {
        if (options.rereadFlags === true || options.rereadFlags === "newest") {
          results.push(
            yield* rereadFlags(
              scope,
              mailbox,
              {
                flagCursor: cached.flagCursor,
                skeletonFloor: cached.skeletonFloor,
                uidNext: cachedUidNext,
                uidValidity: status.uidValidity,
              },
              options.rereadFlags === true ? "all" : "newest"
            )
          );
        }
      } else if (
        cached.highestModseq !== undefined &&
        status.highestModseq > cached.highestModseq &&
        floor < cachedUidNext
      ) {
        const changed = yield* scope.session.fetch(
          mailbox.path,
          status.uidValidity,
          { from: floor, kind: "range", to: cachedUidNext - 1 },
          changeFields(scope.dialect),
          { changedSince: cached.highestModseq }
        );
        results.push(
          yield* store.applyLocationChanges(
            scope.accountId,
            mailbox.path,
            toLocationChanges(scope.dialect, mailbox, changed),
            {}
          )
        );
      }

      // Without QRESYNC an expunge is silent. Below the saved UIDNEXT a count
      // lower than expected is the only sign, and only then is the full UID
      // list compared with the cache. The saved count covers no copy at or
      // above the saved UIDNEXT; those were compared with the search above.
      const expected = (cached.messageCount ?? status.messages) + arrivals;
      if (status.messages < expected) {
        const present = new Set(
          yield* scope.session.search(mailbox.path, status.uidValidity, {
            kind: "all",
          })
        );
        const vanished = (yield* store.locationUids(
          scope.accountId,
          mailbox.path
        )).filter((uid) => !present.has(uid));
        results.push(
          yield* store.removeLocations(scope.accountId, mailbox.path, vanished)
        );
      }

      results.push(
        yield* store.applyLocationChanges(scope.accountId, mailbox.path, [], {
          highestModseq: status.highestModseq,
          messageCount: status.messages,
          uidNext: status.uidNext,
        })
      );
      if (options.drift !== undefined) {
        results.push(yield* checkDrift(scope, mailbox, status, options.drift));
      }
    }).pipe(salvaging(scope, results));

    return mergeThreadChanges(...results);
  }
);

/**
 * Whether a pass can go on without a mailbox the server will not open. Not
 * without the one an account's new mail arrives in: the Inbox, or All Mail
 * on Gmail. A pass that left that out would look caught up while the account
 * receives nothing.
 */
const canLeaveOut = (mailbox: ImapMailbox): boolean =>
  mailbox.role !== "inbox" && mailbox.role !== "all";

/**
 * A mailbox's `STATUS` at the start of its step, or `undefined` for one the
 * pass goes on without: the server lists it and refuses to open it (a shared
 * folder without access, one deleted since the list was read). Nothing of
 * it has been read or saved at that point, so leaving it for the next pass
 * loses nothing. Any other failure, and a refusal later in the step, fails
 * the pass as before.
 */
const openMailbox = (scope: SyncScope, mailbox: ImapMailbox) =>
  scope.session
    .status(mailbox.path)
    .pipe(
      Effect.catchTag("MailboxMissingError", (refusal) =>
        canLeaveOut(mailbox)
          ? Effect.logWarning(
              `A mailbox (${mailbox.role}) would not open and was left out of the pass`
            )
          : Effect.fail(refusal)
      )
    );

/**
 * One pass over every synced mailbox. A copy that vanished from one mailbox
 * is dropped at once, but messages left without any copy are deleted only at
 * the end of the pass, so a message moved between mailboxes keeps its id and
 * bodies when its new copy is read later in the same pass. Discovery's
 * changes go to `scope.discovered` when it is given, and are otherwise
 * returned with the rest.
 *
 * A mailbox that will not open is left out: see `openMailbox`. The pass then
 * deletes no message for having no copy, since a copy may be in the mailbox
 * it could not read.
 */
export const syncAccount = Effect.fn("MailSync.syncAccount")(
  function* syncAccount(scope: SyncScope) {
    const store = yield* MailEngineStore;
    const exclusive =
      scope.exclusive ?? (<A, E, R>(effect: Effect.Effect<A, E, R>) => effect);
    const discovered = yield* exclusive(discoverMailboxes(scope));
    yield* scope.discovered?.(discovered) ?? Effect.void;
    const results: ThreadChanges[] =
      scope.discovered === undefined ? [discovered.changes] : [];

    yield* Effect.gen(function* readMailboxes() {
      let isComplete = true;

      for (const mailbox of discovered.mailboxes) {
        // Read under the same turn as the step: a change made between steps
        // may have moved this mailbox's progress on.
        const changes = yield* exclusive(
          Effect.gen(function* syncOneMailbox() {
            const status = yield* openMailbox(scope, mailbox);
            if (status === undefined) {
              return;
            }
            const cached = (yield* store.getMailboxes(scope.accountId)).find(
              (record) => record.path === mailbox.path
            );
            return yield* syncMailbox(scope, mailbox, cached, {
              drift: scope.drift,
              rereadFlags: true,
              status,
            });
          })
        );
        if (changes === undefined) {
          isComplete = false;
        } else {
          results.push(changes);
        }
      }

      if (isComplete) {
        results.push(yield* exclusive(store.collectOrphans(scope.accountId)));
      }
    }).pipe(salvaging(scope, results));

    return mergeThreadChanges(...results);
  }
);

// ------------------------------------------------------------- skeleton

const INITIAL_SKELETON_WINDOW = SKELETON_BATCH_SIZE * 4;

/**
 * The next batch of UIDs below `floor`, newest first. UIDs are sparse, so the
 * search window widens until it holds a full batch or reaches UID 1.
 */
const nextSkeletonUids = Effect.fn("MailSync.nextSkeletonUids")(
  function* nextSkeletonUids(
    scope: SyncScope,
    path: string,
    uidValidity: bigint,
    floor: number
  ) {
    let window = INITIAL_SKELETON_WINDOW;

    for (;;) {
      const from = Math.max(1, floor - window);
      const uids = yield* scope.session.search(path, uidValidity, {
        from,
        kind: "uidRange",
        to: floor - 1,
      });
      const below = uids.filter((uid) => uid < floor);

      if (below.length >= SKELETON_BATCH_SIZE || from === 1) {
        const batch = below.slice(-SKELETON_BATCH_SIZE);
        const reachedBottom = from === 1 && below.length <= SKELETON_BATCH_SIZE;
        return {
          floor: reachedBottom ? 1 : (batch[0] ?? 1),
          uids: batch,
        };
      }

      window *= 4;
    }
  }
);

/**
 * Moves the skeleton of the highest-priority unfinished mailbox down by one
 * batch. Returns `undefined` when every synced mailbox is complete.
 */
export const skeletonStep = Effect.fn("MailSync.skeletonStep")(
  function* skeletonStep(scope: SyncScope) {
    const store = yield* MailEngineStore;
    const [mailbox] = (yield* store.getMailboxes(scope.accountId))
      .filter(
        (record) =>
          record.synced &&
          record.uidValidity !== undefined &&
          record.skeletonFloor !== undefined &&
          record.skeletonFloor > 1
      )
      .toSorted(byMailboxPriority);

    if (
      mailbox?.uidValidity === undefined ||
      mailbox.skeletonFloor === undefined
    ) {
      return;
    }

    const next = yield* nextSkeletonUids(
      scope,
      mailbox.path,
      mailbox.uidValidity,
      mailbox.skeletonFloor
    );

    const stored = yield* storeSkeleton(
      scope,
      {
        delimiter: mailbox.delimiter,
        flags: [],
        path: mailbox.path,
        role: mailbox.role,
        selectable: mailbox.selectable,
      },
      mailbox.uidValidity,
      next.uids,
      { skeletonFloor: next.floor }
    );

    // Finishing a walk is the first moment a message without any copy is known
    // to be gone rather than not reached yet.
    return withoutArrivals(
      next.floor > 1
        ? stored
        : mergeThreadChanges(
            stored,
            yield* store.collectOrphans(scope.accountId)
          )
    );
  }
);

// --------------------------------------------------------------- bodies

interface PlannedMessage {
  readonly headers: ReturnType<typeof parseHeaderBlock>;
  readonly messageId: MessageId;
  readonly plan: ReturnType<typeof planMessageStructure>;
  readonly uid: number;
}

const sectionKey = (plan: PlannedMessage): string =>
  plan.plan.bodies.map((part) => part.section).join(" ");

/**
 * The copies one fetch can name together: those of one mailbox under one
 * UIDVALIDITY, each with the message it is cached as.
 */
const bodySources = (candidates: readonly BodyCandidate[]) => {
  const sources = new Map<
    string,
    {
      readonly messageIds: Map<number, MessageId>;
      readonly path: string;
      readonly uidValidity: bigint;
    }
  >();
  for (const { mailboxPath, messageId, uid, uidValidity } of candidates) {
    const key = `${uidValidity} ${mailboxPath}`;
    const source = sources.get(key) ?? {
      messageIds: new Map<number, MessageId>(),
      path: mailboxPath,
      uidValidity,
    };
    source.messageIds.set(uid, messageId);
    sources.set(key, source);
  }
  return [...sources.values()];
};

/**
 * Downloads structure, the kept header fields and the text parts of each
 * candidate, never its attachments. A message the server no longer has is
 * skipped; the next sync removes it. Returns nothing when no body was stored,
 * so a batch that cannot make progress is not mistaken for work.
 */
export const fetchBodies = Effect.fn("MailSync.fetchBodies")(
  function* fetchBodies(
    scope: SyncScope,
    candidates: readonly BodyCandidate[]
  ) {
    const store = yield* MailEngineStore;
    const bodies: MessageBodies[] = [];

    // What comes back is saved under the cached message's id, so in a
    // mailbox rebuilt since, where the UID is other mail, nothing may be
    // fetched: the fetch carries the UIDVALIDITY the copies were cached
    // under.
    for (const { messageIds, path, uidValidity } of bodySources(candidates)) {
      const described = yield* scope.session.fetch(
        path,
        uidValidity,
        { kind: "uids", uids: [...messageIds.keys()] },
        { headers: BODY_HEADER_FIELDS, structure: true }
      );
      const planned: PlannedMessage[] = [];

      for (const message of described) {
        const messageId = messageIds.get(message.uid);
        if (messageId === undefined) {
          continue;
        }
        if (message.structure === undefined) {
          bodies.push({ failed: true, headers: [], messageId });
          continue;
        }
        planned.push({
          headers:
            message.headers === undefined
              ? []
              : parseHeaderBlock(message.headers),
          messageId,
          plan: planMessageStructure(message.structure),
          uid: message.uid,
        });
      }

      for (const members of groupBy(planned, sectionKey).values()) {
        const [first] = members;
        const parts = first?.plan.bodies ?? [];
        const fetched =
          parts.length === 0
            ? []
            : yield* scope.session.fetch(
                path,
                uidValidity,
                { kind: "uids", uids: members.map((member) => member.uid) },
                { sections: parts.map((part) => part.section) }
              );
        const sectionsByUid = new Map(
          fetched.map((message) => [message.uid, message.sections])
        );

        for (const member of members) {
          const sections = sectionsByUid.get(member.uid);
          if (
            member.plan.bodies.length > 0 &&
            !member.plan.bodies.some(
              (part) => sections?.get(part.section) !== undefined
            )
          ) {
            // Described, but none of its text came back: saved as it is, a
            // blank body would pass for the message for good. Marked failed
            // so the background queue moves past it rather than asking again
            // at its head forever; opening the conversation tries it again.
            // Had it been deleted meanwhile, the next sync removes it either
            // way. A message some of whose parts came back keeps those: a
            // server that cannot serve one part would otherwise leave the
            // message with no text at all.
            bodies.push({
              failed: true,
              headers: member.headers,
              messageId: member.messageId,
            });
            continue;
          }

          const html: string[] = [];
          const text: string[] = [];
          for (const part of member.plan.bodies) {
            const bytes = sections?.get(part.section);
            if (bytes === undefined) {
              continue;
            }
            const decoded = decodeTextPart(bytes, part.encoding, part.charset);
            (part.mimeType === "text/html" ? html : text).push(decoded);
          }

          bodies.push({
            headers: member.headers,
            html: html.length === 0 ? undefined : html.join("\n"),
            messageId: member.messageId,
            structure: member.plan,
            text: text.length === 0 ? undefined : text.join("\n\n"),
          });
        }
      }
    }

    if (bodies.length === 0) {
      return;
    }

    return yield* store.saveBodies(scope.accountId, bodies);
  }
);

/** Downloads the next batch of missing bodies, newest first. */
export const bodyStep = Effect.fn("MailSync.bodyStep")(function* bodyStep(
  scope: SyncScope,
  options: { readonly receivedAfter?: number } = {}
) {
  const store = yield* MailEngineStore;
  const candidates = yield* store.bodyCandidates(scope.accountId, {
    limit: BODY_BATCH_SIZE,
    receivedAfter: options.receivedAfter,
  });

  if (candidates.length === 0) {
    return;
  }

  return yield* fetchBodies(scope, candidates);
});

/** Foreground: every missing body of one conversation. */
export const loadThreadBodies = Effect.fn("MailSync.loadThreadBodies")(
  function* loadThreadBodies(scope: SyncScope, threadId: ThreadId) {
    const store = yield* MailEngineStore;
    const candidates = yield* store.threadBodyCandidates(
      scope.accountId,
      threadId
    );

    if (candidates.length === 0) {
      return NO_THREAD_CHANGES;
    }

    return (yield* fetchBodies(scope, candidates)) ?? NO_THREAD_CHANGES;
  }
);
