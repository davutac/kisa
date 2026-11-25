import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import {
  mailAccounts,
  mailInlineImages,
  mailLabels,
  mailMailboxes,
  mailMessageLocations,
  mailMessages,
  mailThreads,
} from "@repo/database/schemas";
import type { StoredMailAttachment } from "@repo/database/schemas";
import type { DialectKind } from "@repo/mail/dialects";
import { MailStoreError } from "@repo/mail/errors";
import {
  AccountId,
  LabelId,
  MailboxRole,
  MessageId,
  SystemLabel,
  ThreadId,
} from "@repo/mail/ids";
import {
  conversationPlaces,
  labelsOfCopies,
  listedMessages,
} from "@repo/mail/listing";
import { MailEngineStore } from "@repo/mail/store";
import type {
  BodyCandidate,
  MailAccount,
  MailboxProgress,
  MailboxRecord,
  MessageLocation,
  MessageMetadata,
  ThreadChanges,
} from "@repo/mail/store";
import {
  and,
  desc,
  eq,
  exists,
  gte,
  inArray,
  lt,
  notInArray,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { Effect, Layer, Option, Schema } from "effect";

import { seededLabelColor } from "../../../shared/label-color";
import {
  forgetCachedCorrespondents,
  rememberCorrespondentMessages,
} from "../correspondent-cache";
import type { CorrespondentMessage } from "../correspondent-cache";
import {
  ID_CHUNK_SIZE,
  MailDatabase,
  chunk,
  chunkRows,
  chunkValues,
  excludedColumns,
  fromBigIntText,
  inJson,
  insertRows,
  toBigIntText,
  unique,
  updateEach,
  valuesList,
} from "./mail-database";
import type { MailTransaction } from "./mail-database";
import {
  MAIL_BODY_SCHEMA_VERSION,
  isListedAttachment,
  prepareBody,
} from "./message-content";
import type { PreparedBody } from "./message-content";

const NO_CHANGES: ThreadChanges = { changed: [], removed: [] };

const SYSTEM_LABEL_ORDER: readonly string[] = [
  SystemLabel.inbox,
  SystemLabel.unread,
  SystemLabel.starred,
  SystemLabel.important,
  SystemLabel.sent,
  SystemLabel.draft,
  SystemLabel.spam,
  SystemLabel.trash,
];

/** System labels first in a fixed order, then user labels by name. */
const sortLabels = (labels: Iterable<string>): readonly string[] =>
  unique(labels).toSorted((left, right) => {
    const leftRank = SYSTEM_LABEL_ORDER.indexOf(left);
    const rightRank = SYSTEM_LABEL_ORDER.indexOf(right);
    if (leftRank !== -1 || rightRank !== -1) {
      return (
        (leftRank === -1 ? Number.MAX_SAFE_INTEGER : leftRank) -
        (rightRank === -1 ? Number.MAX_SAFE_INTEGER : rightRank)
      );
    }
    return left.localeCompare(right);
  });

const sameLabels = (
  left: readonly string[],
  right: readonly string[]
): boolean =>
  left.length === right.length &&
  left.every((label, index) => label === right[index]);

const decodeRole = Schema.decodeUnknownOption(MailboxRole);

// ------------------------------------------------------------ projections

/**
 * A message's labels are what the copies it is listed by give it: see
 * `labelsOfCopies`. A message with no copy left keeps empty labels until
 * `collectOrphans` removes it. Returns the threads of every message it
 * looked at, or with `relabelled` only of those whose labels it changed.
 */
const recomputeMessages = async (
  transaction: MailTransaction,
  accountId: string,
  messageIds: readonly string[],
  now: number,
  threadsOf: "looked-at" | "relabelled" = "looked-at"
): Promise<readonly string[]> => {
  const threadIds = new Set<string>();

  for (const ids of chunk(unique(messageIds), ID_CHUNK_SIZE)) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const locations = await transaction
      .select({
        labelIds: mailMessageLocations.labelIds,
        messageId: mailMessageLocations.messageId,
      })
      .from(mailMessageLocations)
      .where(
        and(
          eq(mailMessageLocations.accountId, accountId),
          inJson(mailMessageLocations.messageId, ids)
        )
      )
      .all();
    // oxlint-disable-next-line eslint/no-await-in-loop
    const messages = await transaction
      .select({
        labelIds: mailMessages.labelIds,
        messageId: mailMessages.messageId,
        threadId: mailMessages.threadId,
      })
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.accountId, accountId),
          inJson(mailMessages.messageId, ids)
        )
      )
      .all();
    const copiesByMessage = new Map<string, (typeof locations)[number][]>();

    for (const location of locations) {
      const copies = copiesByMessage.get(location.messageId) ?? [];
      copies.push(location);
      copiesByMessage.set(location.messageId, copies);
    }

    const relabelled: (readonly unknown[])[] = [];
    for (const message of messages) {
      const labels = sortLabels(
        labelsOfCopies(copiesByMessage.get(message.messageId) ?? [])
      );
      const isRelabelled = !sameLabels(labels, message.labelIds);

      if (isRelabelled || threadsOf === "looked-at") {
        threadIds.add(message.threadId);
      }
      if (isRelabelled) {
        relabelled.push([
          message.messageId,
          labels,
          labels.includes(SystemLabel.draft),
          labels.includes(SystemLabel.starred),
          labels.includes(SystemLabel.unread),
        ]);
      }
    }

    if (relabelled.length > 0) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await transaction.run(
        updateEach(mailMessages, relabelled, {
          match: [mailMessages.messageId],
          same: [[mailMessages.updatedAt, now]],
          set: [
            mailMessages.labelIds,
            mailMessages.isDraft,
            mailMessages.isStarred,
            mailMessages.isUnread,
          ],
          where: eq(mailMessages.accountId, accountId),
        })
      );
    }
  }

  return [...threadIds];
};

type ThreadAttachment = StoredMailAttachment & { readonly messageId: string };

/**
 * Rebuilds the list projection of each thread from its messages, and deletes
 * the projection of a thread that has none left.
 */
const recomputeThreads = async (
  transaction: MailTransaction,
  accountId: string,
  threadIds: readonly string[],
  now: number
): Promise<ThreadChanges> => {
  const changed: ThreadId[] = [];
  const removed: ThreadId[] = [];

  for (const ids of chunk(unique(threadIds), ID_CHUNK_SIZE)) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const messages = await transaction
      .select({
        attachments: mailMessages.attachments,
        fromAddress: mailMessages.fromAddress,
        fromName: mailMessages.fromName,
        isUnread: mailMessages.isUnread,
        labelIds: mailMessages.labelIds,
        messageId: mailMessages.messageId,
        receivedAt: mailMessages.receivedAt,
        snippet: mailMessages.snippet,
        subject: mailMessages.subject,
        threadId: mailMessages.threadId,
      })
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.accountId, accountId),
          inJson(mailMessages.threadId, ids)
        )
      )
      .orderBy(mailMessages.receivedAt, mailMessages.messageId)
      .all();
    // oxlint-disable-next-line eslint/no-await-in-loop
    const existing = await transaction
      .select({
        spamAddedAt: mailThreads.spamAddedAt,
        threadId: mailThreads.threadId,
      })
      .from(mailThreads)
      .where(
        and(
          eq(mailThreads.accountId, accountId),
          inJson(mailThreads.threadId, ids)
        )
      )
      .all();
    const spamAddedAt = new Map(
      existing.map((row) => [row.threadId, row.spamAddedAt])
    );
    const byThread = new Map<string, (typeof messages)[number][]>();

    for (const message of messages) {
      const group = byThread.get(message.threadId) ?? [];
      group.push(message);
      byThread.set(message.threadId, group);
    }

    const emptied = ids.filter(
      (threadId) => !byThread.has(threadId) && spamAddedAt.has(threadId)
    );
    if (emptied.length > 0) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await transaction
        .delete(mailThreads)
        .where(
          and(
            eq(mailThreads.accountId, accountId),
            inJson(mailThreads.threadId, emptied)
          )
        )
        .run();
      removed.push(...emptied.map((threadId) => ThreadId.make(threadId)));
    }

    const rows = [...byThread].map(([threadId, messagesOfThread]) => {
      const group = listedMessages(messagesOfThread);
      // Ordered oldest first: the subject is the first message's, and the
      // sender and snippet are the newest message's.
      const [first] = group;
      const latest = group.at(-1);
      const labels = sortLabels(group.flatMap((message) => message.labelIds));
      const attachments: ThreadAttachment[] = group.flatMap((message) =>
        (message.attachments ?? [])
          .filter(isListedAttachment)
          .map((attachment) => ({
            ...attachment,
            messageId: message.messageId,
          }))
      );
      const snippet =
        group.toReversed().find((message) => message.snippet.length > 0)
          ?.snippet ?? "";
      const places = conversationPlaces(messagesOfThread);

      changed.push(ThreadId.make(threadId));
      return {
        accountId,
        attachments,
        fromAddress: latest?.fromAddress ?? "",
        fromName: latest?.fromName ?? null,
        hasAttachments: attachments.length > 0,
        ...places,
        isUnread: group.some((message) => message.isUnread),
        labelIds: labels,
        latestAt: latest?.receivedAt ?? 0,
        latestMessageId: latest?.messageId ?? threadId,
        messageCount: group.length,
        snippet,
        spamAddedAt: places.isInSpam
          ? (spamAddedAt.get(threadId) ?? now)
          : null,
        subject: first?.subject ?? "",
        threadId,
        updatedAt: now,
      };
    });

    if (rows.length > 0) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await transaction.run(
        insertRows(mailThreads, rows, {
          set: [
            "attachments",
            "fromAddress",
            "fromName",
            "hasAttachments",
            "isInInbox",
            "isInSent",
            "isInSpam",
            "isInTrash",
            "isUnread",
            "labelIds",
            "latestAt",
            "latestMessageId",
            "messageCount",
            "snippet",
            "spamAddedAt",
            "subject",
            "updatedAt",
          ],
          target: [mailThreads.accountId, mailThreads.threadId],
        })
      );
    }
  }

  return { changed, removed };
};

const recomputeFromMessages = async (
  transaction: MailTransaction,
  accountId: string,
  messageIds: readonly string[],
  extraThreadIds: readonly string[],
  now: number
): Promise<ThreadChanges> => {
  const threadIds = await recomputeMessages(
    transaction,
    accountId,
    messageIds,
    now
  );
  return recomputeThreads(
    transaction,
    accountId,
    [...threadIds, ...extraThreadIds],
    now
  );
};

const saveProgress = async (
  transaction: MailTransaction,
  accountId: string,
  path: string,
  progress: MailboxProgress,
  now: number
): Promise<void> => {
  // Drizzle leaves out columns whose value is undefined.
  const set = {
    flagCursor: progress.flagCursor,
    highestModseq: toBigIntText(progress.highestModseq),
    labelCursor: progress.labelCursor,
    messageCount: progress.messageCount,
    skeletonFloor: progress.skeletonFloor,
    uidNext: progress.uidNext,
    uidValidity: toBigIntText(progress.uidValidity),
  };

  if (Object.values(set).every((value) => value === undefined)) {
    return;
  }

  await transaction
    .update(mailMailboxes)
    .set({ ...set, updatedAt: now })
    .where(
      and(eq(mailMailboxes.accountId, accountId), eq(mailMailboxes.path, path))
    )
    .run();
};

/** Deletes a mailbox's copies and returns the messages they belonged to. */
const deleteMailboxLocations = async (
  transaction: MailTransaction,
  accountId: string,
  path: string
): Promise<readonly string[]> => {
  const rows = await transaction
    .select({ messageId: mailMessageLocations.messageId })
    .from(mailMessageLocations)
    .where(
      and(
        eq(mailMessageLocations.accountId, accountId),
        eq(mailMessageLocations.mailboxPath, path)
      )
    )
    .all();

  await transaction
    .delete(mailMessageLocations)
    .where(
      and(
        eq(mailMessageLocations.accountId, accountId),
        eq(mailMessageLocations.mailboxPath, path)
      )
    )
    .run();

  return rows.map((row) => row.messageId);
};

/**
 * Deletes messages without any copy, among `messageIds` or, when it is
 * undefined, the whole account.
 */
const deleteMessagesWithoutCopies = async (
  transaction: MailTransaction,
  accountId: string,
  messageIds: readonly string[] | undefined,
  now: number
): Promise<ThreadChanges> => {
  const withoutCopies = sql`not exists (select 1 from ${mailMessageLocations} where ${mailMessageLocations.accountId} = ${mailMessages.accountId} and ${mailMessageLocations.messageId} = ${mailMessages.messageId})`;
  const orphans: { messageId: string; threadId: string }[] = [];

  for (const ids of messageIds === undefined
    ? [undefined]
    : chunk(unique(messageIds), ID_CHUNK_SIZE)) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const rows = await transaction
      .select({
        messageId: mailMessages.messageId,
        threadId: mailMessages.threadId,
      })
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.accountId, accountId),
          ids === undefined ? undefined : inJson(mailMessages.messageId, ids),
          withoutCopies
        )
      )
      .all();
    orphans.push(...rows);
  }

  for (const ids of chunk(
    orphans.map((orphan) => orphan.messageId),
    ID_CHUNK_SIZE
  )) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    await transaction
      .delete(mailMessages)
      .where(
        and(
          eq(mailMessages.accountId, accountId),
          inJson(mailMessages.messageId, ids)
        )
      )
      .run();
    // A message's kept inline images leave with it.
    // oxlint-disable-next-line eslint/no-await-in-loop
    await transaction
      .delete(mailInlineImages)
      .where(
        and(
          eq(mailInlineImages.accountId, accountId),
          inJson(mailInlineImages.messageId, ids)
        )
      )
      .run();
  }

  return recomputeThreads(
    transaction,
    accountId,
    orphans.map((orphan) => orphan.threadId),
    now
  );
};

/** `value` is `prefix` or nested under it with `separator`. */
const isAtOrUnder = (
  value: SQL | SQLiteColumn,
  prefix: string,
  separator: string
): SQL =>
  sql`(${value} = ${prefix} or substr(${value}, 1, length(${prefix + separator})) = ${prefix + separator})`;

/** `value` with its leading `from` replaced by `to`, in SQLite characters. */
const replacePrefix = (
  value: SQL | SQLiteColumn,
  from: string,
  to: string
): SQL => sql`${to} || substr(${value}, length(${from}) + 1)`;

const locationsWithLabel = (accountId: string, match: SQL) =>
  and(
    eq(mailMessageLocations.accountId, accountId),
    sql`exists (select 1 from json_each(${mailMessageLocations.labelIds}) where ${match})`
  );

/** The messages with a copy whose labels match, before they are rewritten. */
const messagesWithLabel = async (
  transaction: MailTransaction,
  accountId: string,
  match: SQL
): Promise<readonly string[]> => {
  const rows = await transaction
    .selectDistinct({ messageId: mailMessageLocations.messageId })
    .from(mailMessageLocations)
    .where(locationsWithLabel(accountId, match))
    .all();
  return rows.map((row) => row.messageId);
};

// --------------------------------------------------------------- writes

const toMessageRow = (
  accountId: string,
  message: MessageMetadata,
  labels: readonly string[],
  now: number
) => ({
  accountId,
  bccAddresses: message.bcc,
  ccAddresses: message.cc,
  firstReference: message.firstReference ?? null,
  fromAddress: message.from.address,
  fromName: message.from.name ?? null,
  inReplyTo: message.inReplyTo ?? null,
  isDraft: labels.includes(SystemLabel.draft),
  isStarred: labels.includes(SystemLabel.starred),
  isUnread: labels.includes(SystemLabel.unread),
  labelIds: labels,
  messageId: message.messageId,
  receivedAt: message.receivedAt,
  replyToAddress: message.replyTo ?? null,
  rfc822MessageId: message.rfc822MessageId ?? null,
  sentAt: message.sentAt ?? null,
  size: message.size,
  subject: message.subject,
  threadId: message.threadId,
  toAddresses: message.to,
  updatedAt: now,
});

/** Metadata columns a skeleton write owns; bodies and labels are kept. */
const MESSAGE_METADATA_COLUMNS = [
  "bccAddresses",
  "ccAddresses",
  "firstReference",
  "fromAddress",
  "fromName",
  "inReplyTo",
  "receivedAt",
  "replyToAddress",
  "rfc822MessageId",
  "sentAt",
  "size",
  "subject",
  "threadId",
  "toAddresses",
  "updatedAt",
] as const;

const toLocationRow = (
  accountId: string,
  path: string,
  uidValidity: bigint,
  location: MessageLocation,
  now: number
) => ({
  accountId,
  flags: location.flags,
  labelIds: sortLabels(location.labelIds),
  mailboxPath: path,
  messageId: location.messageId,
  modseq: toBigIntText(location.modseq) ?? null,
  uid: location.uid,
  uidValidity: uidValidity.toString(),
  updatedAt: now,
});

const applyBatch = async (
  transaction: MailTransaction,
  accountId: string,
  batch: Parameters<
    (typeof MailEngineStore)["Service"]["applyMailboxBatch"]
  >[1],
  now: number
): Promise<ThreadChanges> => {
  const messageIds = batch.messages.map((message) => message.messageId);
  const previousThreads: string[] = [];
  const known = new Set<string>();

  for (const ids of chunk(messageIds, ID_CHUNK_SIZE)) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const rows = await transaction
      .select({
        messageId: mailMessages.messageId,
        threadId: mailMessages.threadId,
      })
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.accountId, accountId),
          inJson(mailMessages.messageId, ids)
        )
      )
      .all();
    previousThreads.push(...rows.map((row) => row.threadId));
    for (const row of rows) {
      known.add(row.messageId);
    }
  }

  const batchLabels = new Map<string, LabelId[]>();
  for (const location of batch.locations) {
    batchLabels.set(location.messageId, [
      ...(batchLabels.get(location.messageId) ?? []),
      ...location.labelIds,
    ]);
  }

  const messageRows = batch.messages.map((message) =>
    toMessageRow(
      accountId,
      message,
      sortLabels(batchLabels.get(message.messageId) ?? []),
      now
    )
  );
  if (messageRows.length > 0) {
    await transaction.run(
      insertRows(mailMessages, messageRows, {
        set: MESSAGE_METADATA_COLUMNS,
        target: [mailMessages.accountId, mailMessages.messageId],
      })
    );
  }

  const locationRows = batch.locations.map((location) =>
    toLocationRow(accountId, batch.path, batch.uidValidity, location, now)
  );
  if (locationRows.length > 0) {
    await transaction.run(
      insertRows(mailMessageLocations, locationRows, {
        set: [
          "flags",
          "labelIds",
          "messageId",
          "modseq",
          "uidValidity",
          "updatedAt",
        ],
        target: [
          mailMessageLocations.accountId,
          mailMessageLocations.mailboxPath,
          mailMessageLocations.uid,
        ],
      })
    );
  }

  const changes = await recomputeFromMessages(
    transaction,
    accountId,
    batch.locations.map((location) => location.messageId),
    previousThreads,
    now
  );
  await saveProgress(
    transaction,
    accountId,
    batch.path,
    { ...batch.progress, uidValidity: batch.uidValidity },
    now
  );
  const arrived = unique(messageIds).filter((id) => !known.has(id));
  return arrived.length === 0
    ? changes
    : { ...changes, arrived: arrived.map((id) => MessageId.make(id)) };
};

const sameSet = (
  left: readonly string[],
  right: readonly string[]
): boolean => {
  const set = new Set(left);
  return (
    set.size === new Set(right).size && right.every((item) => set.has(item))
  );
};

/**
 * Applies new flags and labels to cached copies and returns the messages
 * that actually changed. A server reports every copy whose mod-sequence
 * moved, including changes Kisa made itself, so unchanged copies only get
 * their mod-sequence recorded. A copy reported exactly as cached, as most
 * are when flags are read again without CONDSTORE, is not written at all.
 */
const applyChanges = async (
  transaction: MailTransaction,
  accountId: string,
  path: string,
  changes: Parameters<
    (typeof MailEngineStore)["Service"]["applyLocationChanges"]
  >[2],
  now: number
): Promise<readonly string[]> => {
  // A copy reported twice ends as its last report says, as if written in turn.
  const byUid = new Map(changes.map((change) => [change.uid, change]));
  const touched: string[] = [];
  const reflagged: (readonly unknown[])[] = [];
  const resequenced: (readonly unknown[])[] = [];

  for (const uids of chunk([...byUid.keys()], ID_CHUNK_SIZE)) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const known = await transaction
      .select({
        flags: mailMessageLocations.flags,
        labelIds: mailMessageLocations.labelIds,
        messageId: mailMessageLocations.messageId,
        modseq: mailMessageLocations.modseq,
        uid: mailMessageLocations.uid,
      })
      .from(mailMessageLocations)
      .where(
        and(
          eq(mailMessageLocations.accountId, accountId),
          eq(mailMessageLocations.mailboxPath, path),
          inJson(mailMessageLocations.uid, uids)
        )
      )
      .all();

    for (const current of known) {
      const change = byUid.get(current.uid);
      if (change === undefined) {
        continue;
      }

      const labelIds = sortLabels(change.labelIds);
      const modseq = toBigIntText(change.modseq) ?? null;
      if (
        !sameSet(current.flags, change.flags) ||
        !sameLabels(current.labelIds, labelIds)
      ) {
        touched.push(current.messageId);
        reflagged.push([change.uid, change.flags, labelIds, modseq]);
      } else if (modseq !== current.modseq) {
        resequenced.push([change.uid, modseq]);
      }
    }
  }

  const inPath = and(
    eq(mailMessageLocations.accountId, accountId),
    eq(mailMessageLocations.mailboxPath, path)
  );
  if (reflagged.length > 0) {
    await transaction.run(
      updateEach(mailMessageLocations, reflagged, {
        match: [mailMessageLocations.uid],
        same: [[mailMessageLocations.updatedAt, now]],
        set: [
          mailMessageLocations.flags,
          mailMessageLocations.labelIds,
          mailMessageLocations.modseq,
        ],
        where: inPath,
      })
    );
  }
  if (resequenced.length > 0) {
    await transaction.run(
      updateEach(mailMessageLocations, resequenced, {
        match: [mailMessageLocations.uid],
        set: [mailMessageLocations.modseq],
        where: inPath,
      })
    );
  }

  return touched;
};

const ensureSystemLabels = async (
  transaction: MailTransaction,
  accountId: string,
  now: number
): Promise<void> => {
  await transaction
    .insert(mailLabels)
    .values(
      Object.values(SystemLabel).map((labelId) => ({
        accountId,
        kind: "system" as const,
        labelId,
        // System label names are their ids; the renderer localizes them.
        name: labelId,
        updatedAt: now,
      }))
    )
    .onConflictDoNothing()
    .run();
};

// ---------------------------------------------------------------- store

const toMailAccount = (row: typeof mailAccounts.$inferSelect): MailAccount => ({
  accountId: AccountId.make(row.accountId),
  dialect: row.dialect,
  email: row.email,
  imap: {
    host: row.imapHost,
    port: row.imapPort,
    security: row.imapSecurity,
  },
  provider: row.provider,
  smtp: {
    host: row.smtpHost,
    port: row.smtpPort,
    security: row.smtpSecurity,
  },
  username: row.username,
});

const toMailboxRecord = (
  row: typeof mailMailboxes.$inferSelect
): MailboxRecord => ({
  delimiter: row.delimiter,
  flagCursor: row.flagCursor ?? undefined,
  highestModseq: fromBigIntText(row.highestModseq),
  labelCursor: row.labelCursor ?? undefined,
  messageCount: row.messageCount ?? undefined,
  path: row.path,
  role: Option.getOrElse(decodeRole(row.role), () => "none" as const),
  selectable: row.selectable,
  skeletonFloor: row.skeletonFloor ?? undefined,
  synced: row.synced,
  uidNext: row.uidNext ?? undefined,
  uidValidity: fromBigIntText(row.uidValidity),
});

/**
 * A copy to fetch a body from. One whose UIDVALIDITY cannot be read is left
 * out: without it nothing may be asked of the server by its UID.
 */
const toBodyCandidates = (row: {
  readonly mailboxPath: string;
  readonly messageId: string;
  readonly receivedAt: number;
  readonly size: number;
  readonly uid: number;
  readonly uidValidity: string;
}): readonly BodyCandidate[] => {
  const uidValidity = fromBigIntText(row.uidValidity);
  return uidValidity === undefined
    ? []
    : [
        {
          mailboxPath: row.mailboxPath,
          messageId: MessageId.make(row.messageId),
          receivedAt: row.receivedAt,
          size: row.size,
          uid: row.uid,
          uidValidity,
        },
      ];
};

// A message can have a copy in several mailboxes, each under its own UID,
// and a body is fetched by the mailbox and UID of one of them. SQLite
// reads a bare column from the row that holds the aggregate's minimum, so
// `mailboxPath`, `uidValidity` and `uid` name the same copy. That only holds
// while `min(uid)` is the query's sole min or max.
//
// The messages are chosen first and their copies looked up by message:
// CROSS JOIN keeps SQLite from starting at the account's copies instead,
// which reads every copy in the mailbox to find a handful.
const withCopies = (
  client: RemoteDatabaseClient,
  queue: SQL | undefined,
  options: { readonly limit?: number } = {}
) => {
  const queued = client
    .select({
      accountId: mailMessages.accountId,
      messageId: mailMessages.messageId,
      receivedAt: mailMessages.receivedAt,
      size: mailMessages.size,
    })
    .from(mailMessages)
    .where(
      and(
        queue,
        exists(
          client
            .select({ uid: mailMessageLocations.uid })
            .from(mailMessageLocations)
            .where(
              and(
                eq(mailMessageLocations.accountId, mailMessages.accountId),
                eq(mailMessageLocations.messageId, mailMessages.messageId)
              )
            )
        )
      )
    )
    .orderBy(desc(mailMessages.receivedAt));
  const messages = (
    options.limit === undefined ? queued : queued.limit(options.limit)
  ).as("queued");

  return (
    client
      .select({
        mailboxPath: mailMessageLocations.mailboxPath,
        messageId: messages.messageId,
        receivedAt: messages.receivedAt,
        size: messages.size,
        uid: sql<number>`min(${mailMessageLocations.uid})`,
        uidValidity: mailMessageLocations.uidValidity,
      })
      .from(messages)
      .crossJoin(mailMessageLocations)
      .where(
        and(
          eq(mailMessageLocations.accountId, messages.accountId),
          eq(mailMessageLocations.messageId, messages.messageId)
        )
      )
      // Grouped by the copy's id, which is the message's: grouped by the
      // message's own, SQLite walks every message in the account in key order
      // to save sorting a few.
      .groupBy(mailMessageLocations.messageId)
      .orderBy(desc(messages.receivedAt))
      .all()
  );
};

/** The values `saveBodyRows` sets, in the order its rows list them. */
const BODY_COLUMNS = [
  mailMessages.messageId,
  mailMessages.attachments,
  mailMessages.bodyHtml,
  mailMessages.bodyState,
  mailMessages.bodyText,
  mailMessages.hasAttachments,
  mailMessages.hasBlockedRemoteImages,
  mailMessages.headers,
  mailMessages.senderAuthenticated,
  mailMessages.snippet,
];

const saveBodyRows = async (
  transaction: MailTransaction,
  accountId: string,
  prepared: readonly PreparedBody[],
  now: number
): Promise<ThreadChanges> => {
  const threadIds: string[] = [];
  // A message named twice keeps the last body, as if written in turn.
  const latest = new Map(prepared.map((body) => [body.messageId, body]));
  const rows = [...latest.values()].map((body) => [
    body.messageId,
    body.attachments,
    body.bodyHtml,
    body.bodyState,
    body.bodyText,
    body.hasAttachments,
    body.hasBlockedRemoteImages,
    body.headers,
    body.senderAuthenticated,
    body.snippet,
  ]);

  for (const bodies of chunkValues(rows, BODY_COLUMNS.length)) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const saved = await transaction
      .update(mailMessages)
      .set({
        attachments: sql`body.column2`,
        bodyHtml: sql`body.column3`,
        bodyState: sql`body.column4`,
        bodyText: sql`body.column5`,
        hasAttachments: sql`body.column6`,
        hasBlockedRemoteImages: sql`body.column7`,
        headers: sql`body.column8`,
        schemaVersion: MAIL_BODY_SCHEMA_VERSION,
        senderAuthenticated: sql`body.column9`,
        snippet: sql`body.column10`,
        updatedAt: now,
      })
      .from(sql`(VALUES ${valuesList(BODY_COLUMNS, bodies)}) AS body`)
      .where(
        and(
          eq(mailMessages.accountId, accountId),
          eq(mailMessages.messageId, sql`body.column1`)
        )
      )
      .returning({ threadId: mailMessages.threadId })
      .all();
    threadIds.push(...saved.map((row) => row.threadId));
  }

  return recomputeThreads(transaction, accountId, threadIds, now);
};

const toMailbox = (address: string) => ({ address });

const toCorrespondentMessages = (
  batch: Parameters<(typeof MailEngineStore)["Service"]["applyMailboxBatch"]>[1]
): readonly CorrespondentMessage[] => {
  const spam = new Set(
    batch.locations
      .filter((location) => location.labelIds.includes(SystemLabel.spam))
      .map((location) => location.messageId)
  );
  return batch.messages
    .filter((message) => !spam.has(message.messageId))
    .map((message) => ({
      bcc: message.bcc.map(toMailbox),
      cc: message.cc.map(toMailbox),
      from: message.from,
      to: message.to.map(toMailbox),
    }));
};

/**
 * Where copies were before Trash took them, by account and message, one path
 * per copy. Only Undo reads it, seconds after the move, so it lives in memory
 * rather than SQLite; a restore it cannot answer goes to the Inbox, as one
 * after a restart does. Kept outside the layer so every runtime sees it.
 */
const copyOriginsByAccount = new Map<string, Map<string, readonly string[]>>();

/**
 * Messages remembered per account. Every message Trash takes outside Gmail
 * has an entry until its Undo consumes it, so this bounds what a session of
 * trashing without undoing leaves behind. The oldest go first, and a restore
 * of one of those goes to the Inbox: so does the oldest part of one bulk
 * Trash of more messages than this.
 */
const MAX_REMEMBERED_MESSAGES = 10_000;

const rememberOrigins = (
  accountId: string,
  moved: readonly string[],
  origins: readonly {
    readonly mailboxPath: string;
    readonly messageId: string;
  }[]
): void => {
  const remembered = copyOriginsByAccount.get(accountId) ?? new Map();

  for (const messageId of moved) {
    remembered.delete(messageId);
  }
  for (const { mailboxPath, messageId } of origins) {
    remembered.set(messageId, [
      ...(remembered.get(messageId) ?? []),
      mailboxPath,
    ]);
  }
  for (const messageId of remembered.keys()) {
    if (remembered.size <= MAX_REMEMBERED_MESSAGES) {
      break;
    }
    remembered.delete(messageId);
  }

  if (remembered.size === 0) {
    copyOriginsByAccount.delete(accountId);
  } else {
    copyOriginsByAccount.set(accountId, remembered);
  }
};

/** Whether the message of the row being read carries a label. */
const messageHasLabel = (label: string): SQL => sql`EXISTS (
  SELECT 1 FROM json_each(${mailMessages.labelIds}) AS message_label
  WHERE message_label.value = ${label}
)`;

export const MailEngineStoreLive = Layer.effect(
  MailEngineStore,
  Effect.gen(function* makeMailEngineStore() {
    const database = yield* MailDatabase;

    const inTransaction = <A>(
      message: string,
      run: (transaction: MailTransaction, now: number) => Promise<A>
    ) =>
      database.use(message, (client) =>
        client.transaction((transaction) => run(transaction, Date.now()))
      );

    return MailEngineStore.of({
      applyLocationChanges: (accountId, path, changes, progress) =>
        inTransaction(
          "Could not save mail changes",
          async (transaction, now) => {
            const touched = await applyChanges(
              transaction,
              accountId,
              path,
              changes,
              now
            );
            const result =
              touched.length === 0
                ? NO_CHANGES
                : await recomputeFromMessages(
                    transaction,
                    accountId,
                    touched,
                    [],
                    now
                  );
            await saveProgress(transaction, accountId, path, progress, now);
            return result;
          }
        ),

      applyMailboxBatch: (accountId, batch) =>
        inTransaction("Could not save fetched mail", (transaction, now) =>
          applyBatch(transaction, accountId, batch, now)
        ).pipe(
          // After the commit: compose completion learns new correspondents
          // without rescanning. Spam is never offered as a suggestion.
          Effect.tap(() =>
            Effect.sync(() => {
              rememberCorrespondentMessages(
                accountId,
                toCorrespondentMessages(batch)
              );
            })
          )
        ),

      bodyCandidates: (accountId, options) =>
        database.use("Could not load pending mail", async (client) => {
          // Walks the body queue index newest first and stops at the limit.
          const rows = await withCopies(
            client,
            and(
              eq(mailMessages.accountId, accountId),
              eq(mailMessages.bodyState, "none"),
              options.receivedAfter === undefined
                ? undefined
                : gte(mailMessages.receivedAt, options.receivedAfter)
            ),
            { limit: options.limit }
          );
          return rows.flatMap(toBodyCandidates);
        }),

      clearAccount: (accountId) =>
        inTransaction(
          "Could not clear the mail account",
          async (transaction) => {
            forgetCachedCorrespondents(accountId);
            copyOriginsByAccount.delete(accountId);
            // Deleting message rows also clears their FTS entries (triggers).
            for (const table of [
              mailMessageLocations,
              mailMessages,
              mailInlineImages,
              mailThreads,
              mailMailboxes,
              mailLabels,
            ]) {
              // oxlint-disable-next-line eslint/no-await-in-loop
              await transaction
                .delete(table)
                .where(eq(table.accountId, accountId))
                .run();
            }
          }
        ),

      collectOrphans: (accountId) =>
        inTransaction("Could not clean up mail", async (transaction, now) => {
          // A copy below an unfinished skeleton floor is not cached yet, so a
          // message without a copy may only be waiting for the walk (after a
          // UIDVALIDITY reset, for example). Deleting it then would throw away
          // its body.
          const [unfinished] = await transaction
            .select({ path: mailMailboxes.path })
            .from(mailMailboxes)
            .where(
              and(
                eq(mailMailboxes.accountId, accountId),
                eq(mailMailboxes.synced, true),
                sql`(${mailMailboxes.skeletonFloor} is null or ${mailMailboxes.skeletonFloor} > 1)`
              )
            )
            .limit(1)
            .all();

          if (unfinished !== undefined) {
            return NO_CHANGES;
          }

          return deleteMessagesWithoutCopies(
            transaction,
            accountId,
            undefined,
            now
          );
        }),

      mailboxCounts: (accountId, path) =>
        database.use("Could not count cached mail", async (client) => {
          // Unread as the dialect files it, on each copy's own labels.
          const [counts] = await client.values<[number, number | null]>(sql`
            SELECT count(*), sum(EXISTS (
              SELECT 1 FROM json_each(${mailMessageLocations.labelIds}) AS copy_label
              WHERE copy_label.value = ${SystemLabel.unread}
            ))
            FROM ${mailMessageLocations}
            WHERE ${mailMessageLocations.accountId} = ${accountId}
              AND ${mailMessageLocations.mailboxPath} = ${path}
          `);
          return { copies: counts?.[0] ?? 0, unread: counts?.[1] ?? 0 };
        }),

      relistHidden: (accountId) =>
        inTransaction(
          "Could not list conversations again",
          async (transaction, now) => {
            // From the rows under Trash or Spam to their messages. Left to
            // itself SQLite reads every row of the account to find them, so
            // the index and the order of the join are both stated.
            const hiddenUnder = (
              index: "mail_threads_spam_idx" | "mail_threads_trash_idx",
              filed: SQL,
              listedElsewhere: SQL
            ) =>
              transaction.values<[string]>(sql`
                SELECT DISTINCT ${mailThreads.threadId}
                FROM ${mailThreads} INDEXED BY ${sql.raw(index)}
                CROSS JOIN ${mailMessages}
                WHERE ${filed}
                  AND ${mailThreads.accountId} = ${accountId}
                  AND ${mailMessages.accountId} = ${mailThreads.accountId}
                  AND ${mailMessages.threadId} = ${mailThreads.threadId}
                  AND ${listedElsewhere}
              `);
            // A message once carried the labels of every copy, so one with
            // a copy in Trash or Spam and another elsewhere may still be
            // filed with the discarded one. No row under Trash leads to it
            // when other mail lists its conversation, so these are found
            // from the copies in Trash and Spam, and only those the rule
            // labels otherwise are written.
            const besideDiscarded = await transaction.values<[string]>(sql`
              SELECT DISTINCT ${mailMessageLocations.messageId}
              FROM ${mailMailboxes}
              CROSS JOIN ${mailMessageLocations}
              WHERE ${mailMailboxes.accountId} = ${accountId}
                AND ${mailMailboxes.role} IN ('junk', 'trash')
                AND ${mailMessageLocations.accountId} = ${mailMailboxes.accountId}
                AND ${mailMessageLocations.mailboxPath} = ${mailMailboxes.path}
                AND EXISTS (
                  SELECT 1 FROM ${mailMessageLocations} AS other
                  WHERE other.account_id = ${mailMessageLocations.accountId}
                    AND other.message_id = ${mailMessageLocations.messageId}
                    AND other.mailbox_path <> ${mailMessageLocations.mailboxPath}
                )
            `);
            const relabelled = await recomputeMessages(
              transaction,
              accountId,
              besideDiscarded.map(([messageId]) => messageId),
              now,
              "relabelled"
            );

            const outsideTrash = sql`NOT ${messageHasLabel(SystemLabel.trash)}`;
            const hidden = [
              ...relabelled.map((threadId) => [threadId] as const),
              ...(await hiddenUnder(
                "mail_threads_trash_idx",
                sql`${mailThreads.isInTrash} = 1`,
                outsideTrash
              )),
              ...(await hiddenUnder(
                "mail_threads_spam_idx",
                sql`${mailThreads.isInSpam} = 1`,
                sql`${messageHasLabel(SystemLabel.inbox)}
                  AND NOT ${messageHasLabel(SystemLabel.spam)}
                  AND ${outsideTrash}`
              )),
            ].map(([threadId]) => threadId);

            return hidden.length === 0
              ? NO_CHANGES
              : recomputeThreads(transaction, accountId, unique(hidden), now);
          }
        ),

      copyOrigins: (accountId, messageIds) =>
        Effect.sync(() => {
          const remembered = copyOriginsByAccount.get(accountId);
          const origins = new Map<MessageId, readonly string[]>();

          for (const messageId of messageIds) {
            const paths = remembered?.get(messageId);
            if (paths !== undefined) {
              origins.set(messageId, paths);
            }
          }
          return origins;
        }),

      forgetCopyOrigins: (accountId, messageIds) =>
        Effect.sync(() => {
          rememberOrigins(accountId, messageIds, []);
        }),

      findAttachment: (accountId, messageId, section) =>
        database.use("Could not find the attachment", async (client) => {
          const [message] = await client
            .select({ attachments: mailMessages.attachments })
            .from(mailMessages)
            .where(
              and(
                eq(mailMessages.accountId, accountId),
                eq(mailMessages.messageId, messageId)
              )
            )
            .limit(1)
            .all();
          const attachment = message?.attachments?.find(
            (candidate) => candidate.section === section
          );
          const [location] = await client
            .select({
              mailboxPath: mailMessageLocations.mailboxPath,
              uid: mailMessageLocations.uid,
              uidValidity: mailMessageLocations.uidValidity,
            })
            .from(mailMessageLocations)
            .where(
              and(
                eq(mailMessageLocations.accountId, accountId),
                eq(mailMessageLocations.messageId, messageId)
              )
            )
            .limit(1)
            .all();

          const uidValidity = fromBigIntText(location?.uidValidity);
          return attachment === undefined ||
            location === undefined ||
            uidValidity === undefined
            ? Option.none()
            : Option.some({
                encoding: attachment.encoding,
                filename: attachment.filename,
                mailboxPath: location.mailboxPath,
                mediaType: attachment.mediaType,
                section: attachment.section,
                size: attachment.size,
                uid: location.uid,
                uidValidity,
              });
        }),

      getAccount: (accountId) =>
        database.use("Could not load the mail account", async (client) => {
          const [row] = await client
            .select()
            .from(mailAccounts)
            .where(eq(mailAccounts.accountId, accountId))
            .limit(1)
            .all();
          return row === undefined
            ? Option.none()
            : Option.some(toMailAccount(row));
        }),

      getMailboxes: (accountId) =>
        database.use("Could not load mailboxes", async (client) => {
          const rows = await client
            .select()
            .from(mailMailboxes)
            .where(eq(mailMailboxes.accountId, accountId))
            .all();
          return rows.map(toMailboxRecord);
        }),

      locationUids: (accountId, path, from) =>
        database.use("Could not load cached mail", async (client) => {
          const rows = await client
            .select({ uid: mailMessageLocations.uid })
            .from(mailMessageLocations)
            .where(
              and(
                eq(mailMessageLocations.accountId, accountId),
                eq(mailMessageLocations.mailboxPath, path),
                from === undefined
                  ? undefined
                  : gte(mailMessageLocations.uid, from)
              )
            )
            .all();
          return rows.map((row) => row.uid);
        }),

      removeLabel: (accountId, labelId) =>
        inTransaction("Could not remove a label", async (transaction, now) => {
          const match = sql`value = ${labelId}`;
          const messageIds = await messagesWithLabel(
            transaction,
            accountId,
            match
          );

          await transaction
            .update(mailMessageLocations)
            .set({
              labelIds: sql`(select json_group_array(value) from json_each(${mailMessageLocations.labelIds}) where not (${match}))`,
              updatedAt: now,
            })
            .where(locationsWithLabel(accountId, match))
            .run();
          await transaction
            .delete(mailLabels)
            .where(
              and(
                eq(mailLabels.accountId, accountId),
                eq(mailLabels.labelId, labelId)
              )
            )
            .run();

          return recomputeFromMessages(
            transaction,
            accountId,
            messageIds,
            [],
            now
          );
        }),

      removeLocations: (accountId, path, uids) =>
        uids.length === 0
          ? Effect.succeed(NO_CHANGES)
          : inTransaction("Could not remove mail", async (transaction, now) => {
              const messageIds: string[] = [];

              for (const uidChunk of chunk(uids, ID_CHUNK_SIZE)) {
                const where = and(
                  eq(mailMessageLocations.accountId, accountId),
                  eq(mailMessageLocations.mailboxPath, path),
                  inJson(mailMessageLocations.uid, uidChunk)
                );
                // oxlint-disable-next-line eslint/no-await-in-loop
                const rows = await transaction
                  .select({ messageId: mailMessageLocations.messageId })
                  .from(mailMessageLocations)
                  .where(where)
                  .all();
                messageIds.push(...rows.map((row) => row.messageId));
                // oxlint-disable-next-line eslint/no-await-in-loop
                await transaction
                  .delete(mailMessageLocations)
                  .where(where)
                  .run();
              }

              return recomputeFromMessages(
                transaction,
                accountId,
                messageIds,
                [],
                now
              );
            }),

      rememberCopyOrigins: (accountId, moved, origins) =>
        Effect.sync(() => {
          rememberOrigins(accountId, moved, origins);
        }),

      removeMessagesWithoutCopies: (accountId, messageIds) =>
        messageIds.length === 0
          ? Effect.succeed(NO_CHANGES)
          : inTransaction("Could not delete mail", (transaction, now) =>
              deleteMessagesWithoutCopies(
                transaction,
                accountId,
                messageIds,
                now
              )
            ),

      renameLabel: (accountId, { delimiter, from, to }) =>
        inTransaction("Could not rename a label", async (transaction, now) => {
          const separator = delimiter.length === 0 ? "/" : delimiter;
          const idMatch = isAtOrUnder(sql`value`, from.id, "/");
          const messageIds = await messagesWithLabel(
            transaction,
            accountId,
            idMatch
          );

          await transaction
            .update(mailMailboxes)
            .set({
              path: replacePrefix(mailMailboxes.path, from.path, to.path),
              updatedAt: now,
            })
            .where(
              and(
                eq(mailMailboxes.accountId, accountId),
                isAtOrUnder(mailMailboxes.path, from.path, separator)
              )
            )
            .run();
          await transaction
            .update(mailMessageLocations)
            .set({
              mailboxPath: replacePrefix(
                mailMessageLocations.mailboxPath,
                from.path,
                to.path
              ),
            })
            .where(
              and(
                eq(mailMessageLocations.accountId, accountId),
                isAtOrUnder(
                  mailMessageLocations.mailboxPath,
                  from.path,
                  separator
                )
              )
            )
            .run();
          await transaction
            .update(mailMessageLocations)
            .set({
              labelIds: sql`(select json_group_array(case when ${idMatch} then ${replacePrefix(sql`value`, from.id, to.id)} else value end) from json_each(${mailMessageLocations.labelIds}))`,
              updatedAt: now,
            })
            .where(locationsWithLabel(accountId, idMatch))
            .run();
          // Colours are kept on the label rows, so the rows move rather than
          // being recreated by the next catalog refresh.
          await transaction
            .update(mailLabels)
            .set({
              labelId: replacePrefix(mailLabels.labelId, from.id, to.id),
              mailboxPath: replacePrefix(
                mailLabels.mailboxPath,
                from.path,
                to.path
              ),
              updatedAt: now,
            })
            .where(
              and(
                eq(mailLabels.accountId, accountId),
                eq(mailLabels.kind, "user"),
                isAtOrUnder(mailLabels.labelId, from.id, "/")
              )
            )
            .run();

          return recomputeFromMessages(
            transaction,
            accountId,
            messageIds,
            [],
            now
          );
        }),

      replaceMailboxes: (accountId, mailboxes, labels) =>
        inTransaction("Could not save mailboxes", async (transaction, now) => {
          await ensureSystemLabels(transaction, accountId, now);

          const existing = await transaction
            .select({ path: mailMailboxes.path })
            .from(mailMailboxes)
            .where(eq(mailMailboxes.accountId, accountId))
            .all();
          const listed = new Set(mailboxes.map((mailbox) => mailbox.path));
          const gone = existing
            .map((row) => row.path)
            .filter((path) => !listed.has(path));
          const unsynced = mailboxes
            .filter((mailbox) => !mailbox.synced)
            .map((mailbox) => mailbox.path);

          if (mailboxes.length > 0) {
            await transaction
              .insert(mailMailboxes)
              .values(
                mailboxes.map((mailbox) => ({
                  accountId,
                  delimiter: mailbox.delimiter,
                  path: mailbox.path,
                  role: mailbox.role,
                  selectable: mailbox.selectable,
                  synced: mailbox.synced,
                  updatedAt: now,
                }))
              )
              .onConflictDoUpdate({
                set: excludedColumns(mailMailboxes, [
                  "delimiter",
                  "role",
                  "selectable",
                  "synced",
                  "updatedAt",
                ]),
                target: [mailMailboxes.accountId, mailMailboxes.path],
              })
              .run();
          }

          const affected: string[] = [];
          for (const path of [...gone, ...unsynced]) {
            // oxlint-disable-next-line eslint/no-await-in-loop
            const removedFrom = await deleteMailboxLocations(
              transaction,
              accountId,
              path
            );
            affected.push(...removedFrom);
          }
          if (gone.length > 0) {
            await transaction
              .delete(mailMailboxes)
              .where(
                and(
                  eq(mailMailboxes.accountId, accountId),
                  inArray(mailMailboxes.path, gone)
                )
              )
              .run();
          }
          if (unsynced.length > 0) {
            // A mailbox the dialect stops reading starts over if it returns.
            await transaction
              .update(mailMailboxes)
              .set({
                flagCursor: null,
                highestModseq: null,
                labelCursor: null,
                messageCount: null,
                skeletonFloor: null,
                uidNext: null,
                uidValidity: null,
              })
              .where(
                and(
                  eq(mailMailboxes.accountId, accountId),
                  inArray(mailMailboxes.path, unsynced)
                )
              )
              .run();
          }

          const labelIds = labels.map((label) => label.id as string);
          await transaction
            .delete(mailLabels)
            .where(
              and(
                eq(mailLabels.accountId, accountId),
                eq(mailLabels.kind, "user"),
                labelIds.length === 0
                  ? undefined
                  : notInArray(mailLabels.labelId, labelIds)
              )
            )
            .run();
          for (const rows of chunkRows(
            labels.map((label) => ({
              accountId,
              backgroundColor: seededLabelColor(label.name),
              kind: "user" as const,
              labelId: label.id,
              mailboxPath: label.path,
              name: label.name,
              updatedAt: now,
            })),
            mailLabels
          )) {
            // A label gets its colour when first seen, and a colour already
            // chosen survives a refresh of the catalog.
            // oxlint-disable-next-line eslint/no-await-in-loop
            await transaction
              .insert(mailLabels)
              .values(rows)
              .onConflictDoUpdate({
                set: {
                  ...excludedColumns(mailLabels, [
                    "mailboxPath",
                    "name",
                    "updatedAt",
                  ]),
                  backgroundColor: sql`coalesce(${mailLabels.backgroundColor}, excluded.background_color)`,
                },
                target: [mailLabels.accountId, mailLabels.labelId],
              })
              .run();
          }

          return recomputeFromMessages(
            transaction,
            accountId,
            affected,
            [],
            now
          );
        }),

      resetMailbox: (accountId, path, progress) =>
        inTransaction("Could not reset a mailbox", async (transaction, now) => {
          const affected = await deleteMailboxLocations(
            transaction,
            accountId,
            path
          );
          const changes = await recomputeFromMessages(
            transaction,
            accountId,
            affected,
            [],
            now
          );
          // The old UIDs mean nothing now: the flag slices start over, and
          // the walk reads every label again anyway.
          await transaction
            .update(mailMailboxes)
            .set({ flagCursor: null, labelCursor: null })
            .where(
              and(
                eq(mailMailboxes.accountId, accountId),
                eq(mailMailboxes.path, path)
              )
            )
            .run();
          await saveProgress(transaction, accountId, path, progress, now);
          return changes;
        }),

      saveBodies: (accountId, bodies) => {
        if (bodies.length === 0) {
          return Effect.succeed(NO_CHANGES);
        }

        return Effect.gen(function* saveBodies() {
          const context = yield* database.use(
            "Could not load messages",
            async (client) => {
              const [account] = await client
                .select({ dialect: mailAccounts.dialect })
                .from(mailAccounts)
                .where(eq(mailAccounts.accountId, accountId))
                .limit(1)
                .all();
              const senders = new Map<string, string>();
              for (const ids of chunk(
                bodies.map((body) => body.messageId as string),
                ID_CHUNK_SIZE
              )) {
                // oxlint-disable-next-line eslint/no-await-in-loop
                const rows = await client
                  .select({
                    fromAddress: mailMessages.fromAddress,
                    messageId: mailMessages.messageId,
                  })
                  .from(mailMessages)
                  .where(
                    and(
                      eq(mailMessages.accountId, accountId),
                      inArray(mailMessages.messageId, ids)
                    )
                  )
                  .all();
                for (const row of rows) {
                  senders.set(row.messageId, row.fromAddress);
                }
              }
              return {
                dialect: account?.dialect ?? ("generic" satisfies DialectKind),
                senders,
              };
            }
          );
          // Compression and text extraction happen before the connection is
          // taken, so they never hold up foreground reads.
          const prepared = yield* Effect.tryPromise({
            catch: (cause) =>
              new MailStoreError({
                cause,
                message: "Could not prepare message bodies",
              }),
            try: () =>
              Promise.all(
                bodies.flatMap((body) => {
                  const fromAddress = context.senders.get(body.messageId);
                  return fromAddress === undefined
                    ? []
                    : [
                        prepareBody(body, {
                          dialect: context.dialect,
                          fromAddress,
                        }),
                      ];
                })
              ),
          });

          return yield* inTransaction(
            "Could not save message bodies",
            (transaction, now) =>
              saveBodyRows(transaction, accountId, prepared, now)
          );
        });
      },

      threadBodyCandidates: (accountId, threadId) =>
        database.use("Could not load pending mail", async (client) => {
          const rows = await withCopies(
            client,
            and(
              eq(mailMessages.accountId, accountId),
              eq(mailMessages.threadId, threadId),
              // The unary plus keeps SQLite from walking the account's whole
              // body queue for one conversation's few messages.
              inArray(sql`+${mailMessages.bodyState}`, ["none", "failed"])
            )
          );
          return rows.flatMap(toBodyCandidates);
        }),

      threadLocations: (accountId, threadIds) =>
        database.use("Could not load the conversation", async (client) => {
          const chunks = await Promise.all(
            chunk(unique(threadIds), ID_CHUNK_SIZE).map((ids) =>
              client
                .select({
                  flags: mailMessageLocations.flags,
                  labelIds: mailMessageLocations.labelIds,
                  mailboxPath: mailMessageLocations.mailboxPath,
                  messageId: mailMessageLocations.messageId,
                  threadId: mailMessages.threadId,
                  uid: mailMessageLocations.uid,
                  uidValidity: mailMessageLocations.uidValidity,
                })
                // Threads first, then their copies: see `withCopies`.
                .from(mailMessages)
                .crossJoin(mailMessageLocations)
                .where(
                  and(
                    eq(mailMessages.accountId, accountId),
                    inJson(mailMessages.threadId, ids),
                    eq(mailMessageLocations.accountId, mailMessages.accountId),
                    eq(mailMessageLocations.messageId, mailMessages.messageId)
                  )
                )
                .all()
            )
          );
          return chunks.flat().flatMap((row) => {
            const uidValidity = fromBigIntText(row.uidValidity);
            // Without it nothing may be asked of the server by this UID.
            return uidValidity === undefined
              ? []
              : [
                  {
                    flags: row.flags,
                    labelIds: row.labelIds.map((label) => LabelId.make(label)),
                    mailboxPath: row.mailboxPath,
                    messageId: MessageId.make(row.messageId),
                    threadId: ThreadId.make(row.threadId),
                    uid: row.uid,
                    uidValidity,
                  },
                ];
          });
        }),

      uidWindowStart: (accountId, path, below, count) =>
        database.use("Could not load cached mail", async (client) => {
          // Walks the primary key down from `below`, so the cost is `count`
          // rows however large the mailbox is.
          const window = client
            .select({ uid: mailMessageLocations.uid })
            .from(mailMessageLocations)
            .where(
              and(
                eq(mailMessageLocations.accountId, accountId),
                eq(mailMessageLocations.mailboxPath, path),
                lt(mailMessageLocations.uid, below)
              )
            )
            .orderBy(desc(mailMessageLocations.uid))
            .limit(count)
            .as("window");
          const [row] = await client
            .select({ start: sql<number | null>`min(${window.uid})` })
            .from(window)
            .all();
          return row?.start ?? undefined;
        }),
    });
  })
);
