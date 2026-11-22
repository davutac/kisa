import { Effect } from "effect";

import type { Dialect, MessageIdentity } from "./dialects";
import type { MailStoreError, MailTransportError } from "./errors";
import { getHeaderValue, parseHeaderBlock, parseMessageIds } from "./headers";
import type { AccountId, MailboxRole, MessageId, ThreadId } from "./ids";
import { planMessageStructure } from "./mime-structure";
import type {
  FetchedMessage,
  ImapMailbox,
  ImapSession,
  MessageEnvelope,
} from "./session";
import { MailEngineStore } from "./store";
import type {
  BodyCandidate,
  LocationChange,
  MailAddress,
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

export interface SyncScope {
  readonly accountId: AccountId;
  readonly dialect: Dialect;
  /**
   * Runs one step of a full pass that writes cached copies, so the caller can
   * keep other writers out for that step only, not for the whole pass.
   */
  readonly exclusive?: <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>;
  readonly session: ImapSession;
}

export type SyncError = MailStoreError | MailTransportError;

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

export const discoverMailboxes = Effect.fn("MailSync.discoverMailboxes")(
  function* discoverMailboxes(scope: SyncScope) {
    const store = yield* MailEngineStore;
    const listed = yield* scope.session.listMailboxes;
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
    const changes = yield* store.replaceMailboxes(
      scope.accountId,
      records,
      scope.dialect.userLabels(listed)
    );

    return {
      changes,
      mailboxes: listed
        .filter((mailbox) => synced.has(mailbox.path))
        .toSorted(byMailboxPriority),
    };
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
 */
const rereadFlags = Effect.fn("MailSync.rereadFlags")(function* rereadFlags(
  scope: SyncScope,
  mailbox: ImapMailbox,
  cached: {
    readonly flagCursor?: number | undefined;
    readonly skeletonFloor?: number | undefined;
    readonly uidNext: number;
  }
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

  const fields = changeFields(scope.dialect);
  const head = yield* scope.session.fetch(
    path,
    { from: Math.max(headStart, floor), kind: "range", to: cached.uidNext - 1 },
    fields
  );
  const slice =
    sliceStart === undefined
      ? []
      : yield* scope.session.fetch(
          path,
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

/**
 * Brings one mailbox's cached copies up to date: new mail at or above the
 * stored UIDNEXT, flag and label changes, and copies that are gone. Mail
 * below the skeleton floor is left to the walk.
 *
 * With CONDSTORE, changes since the stored mod-sequence are fetched. Without
 * it, `rereadFlags` reads a bounded part of the cache again; only the
 * background pass asks for that, since a refresh after the user's own change
 * already knows the flags it set.
 */
export const syncMailbox = Effect.fn("MailSync.syncMailbox")(
  function* syncMailbox(
    scope: SyncScope,
    mailbox: ImapMailbox,
    cached: MailboxRecord | undefined,
    options: { readonly rereadFlags?: boolean } = {}
  ) {
    const store = yield* MailEngineStore;
    const status = yield* scope.session.status(mailbox.path);

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

    const results: ThreadChanges[] = [];
    let arrivals = 0;

    if (status.uidNext > cached.uidNext) {
      // `n:*` always returns the newest message, even below n.
      const newUids = (yield* scope.session.search(mailbox.path, {
        from: cached.uidNext,
        kind: "uidRange",
        to: status.uidNext - 1,
      })).filter((uid) => uid >= (cached.uidNext ?? 1));
      arrivals = newUids.length;

      const batches = chunk(newUids, SKELETON_BATCH_SIZE);
      for (const uids of batches) {
        results.push(
          yield* storeSkeleton(scope, mailbox, status.uidValidity, uids, {})
        );
      }
    }

    const floor = cached.skeletonFloor ?? cached.uidNext;
    if (status.highestModseq === undefined) {
      if (options.rereadFlags === true) {
        results.push(
          yield* rereadFlags(scope, mailbox, {
            flagCursor: cached.flagCursor,
            skeletonFloor: cached.skeletonFloor,
            uidNext: cached.uidNext,
          })
        );
      }
    } else if (
      cached.highestModseq !== undefined &&
      status.highestModseq > cached.highestModseq &&
      floor < cached.uidNext
    ) {
      const changed = yield* scope.session.fetch(
        mailbox.path,
        { from: floor, kind: "range", to: cached.uidNext - 1 },
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

    // Without QRESYNC an expunge is silent; a count lower than expected is the
    // only sign. Only then is the full UID list compared with the cache.
    const expected = (cached.messageCount ?? status.messages) + arrivals;
    if (status.messages < expected) {
      const present = new Set(
        yield* scope.session.search(mailbox.path, { kind: "all" })
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

    return mergeThreadChanges(...results);
  }
);

/**
 * One pass over every synced mailbox. A copy that vanished from one mailbox
 * is dropped at once, but messages left without any copy are deleted only at
 * the end of the pass, so a message moved between mailboxes keeps its id and
 * bodies when its new copy is read later in the same pass.
 */
export const syncAccount = Effect.fn("MailSync.syncAccount")(
  function* syncAccount(scope: SyncScope) {
    const store = yield* MailEngineStore;
    const exclusive =
      scope.exclusive ?? (<A, E, R>(effect: Effect.Effect<A, E, R>) => effect);
    const discovered = yield* exclusive(discoverMailboxes(scope));
    const results: ThreadChanges[] = [discovered.changes];

    for (const mailbox of discovered.mailboxes) {
      // Read under the same turn as the step: a change made between steps
      // may have moved this mailbox's progress on.
      results.push(
        yield* exclusive(
          Effect.gen(function* syncOneMailbox() {
            const cached = (yield* store.getMailboxes(scope.accountId)).find(
              (record) => record.path === mailbox.path
            );
            return yield* syncMailbox(scope, mailbox, cached, {
              rereadFlags: true,
            });
          })
        )
      );
    }

    results.push(yield* exclusive(store.collectOrphans(scope.accountId)));
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
  function* nextSkeletonUids(scope: SyncScope, path: string, floor: number) {
    let window = INITIAL_SKELETON_WINDOW;

    for (;;) {
      const from = Math.max(1, floor - window);
      const uids = yield* scope.session.search(path, {
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

    for (const [path, group] of groupBy(
      candidates,
      (candidate) => candidate.mailboxPath
    )) {
      const messageIds = new Map(
        group.map((candidate) => [candidate.uid, candidate.messageId])
      );
      const described = yield* scope.session.fetch(
        path,
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
                { kind: "uids", uids: members.map((member) => member.uid) },
                { sections: parts.map((part) => part.section) }
              );
        const sectionsByUid = new Map(
          fetched.map((message) => [message.uid, message.sections])
        );

        for (const member of members) {
          const sections = sectionsByUid.get(member.uid);
          if (parts.length > 0 && sections === undefined) {
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
