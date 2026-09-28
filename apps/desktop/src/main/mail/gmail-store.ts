import { promisify } from "node:util";
import { gzip } from "node:zlib";

import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import {
  gmailBackfillState,
  gmailLabels,
  gmailMessages,
  gmailSyncState,
  gmailThreads,
} from "@repo/database/schemas";
import { GmailStoreError } from "@repo/gmail/errors";
import type {
  GmailAuthorization,
  GmailMessage,
  GmailScope,
  GmailThread,
  Mailbox,
} from "@repo/gmail/models";
import {
  AccountId,
  GmailAccount,
  GmailLabel,
  HistoryId,
  LabelColor,
  LabelId,
  ThreadId,
  getGmailCapabilities,
  isGmailScope,
} from "@repo/gmail/models";
import { GmailStore } from "@repo/gmail/store";
import { and, eq, getColumns, inArray, notInArray, sql } from "drizzle-orm";
import type { InferInsertModel, SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { Effect, Layer, Option, Redacted } from "effect";

import { getGoogleAccessToken } from "../auth/auth";
import { withDatabaseClient } from "../database";
import {
  forgetCachedCorrespondents,
  rememberCorrespondentMessages,
} from "./correspondent-cache";
import { toIndexText } from "./message-text";

const storeError = (message: string) => new GmailStoreError({ message });

const gzipAsync = promisify(gzip);

/**
 * Each statement is a round trip to the database process made while holding
 * the connection that foreground reads wait on, so page writes are sent as
 * multi-row statements. Chunks stay under SQLite's historical 999 bound
 * parameter limit, counting every column as a parameter.
 */
const MAX_BOUND_PARAMETERS = 999;

const chunkRows = <A>(
  rows: readonly A[],
  table: SQLiteTable
): readonly (readonly A[])[] => {
  const size = Math.max(
    1,
    Math.floor(MAX_BOUND_PARAMETERS / Object.keys(getColumns(table)).length)
  );
  const chunks: A[][] = [];

  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }

  return chunks;
};

interface DetailMembership {
  readonly messageIds: string[];
  readonly threadIds: string[];
}

/** Groups threads so each stale-message delete stays under the limit. */
const chunkDetailMembership = (
  details: readonly GmailThread[]
): readonly DetailMembership[] => {
  const chunks: DetailMembership[] = [];
  let current: DetailMembership = { messageIds: [], threadIds: [] };

  for (const detail of details) {
    const parameters = 1 + detail.messages.length;

    if (
      current.threadIds.length > 0 &&
      1 + current.threadIds.length + current.messageIds.length + parameters >
        MAX_BOUND_PARAMETERS
    ) {
      chunks.push(current);
      current = { messageIds: [], threadIds: [] };
    }

    current.threadIds.push(detail.id);
    current.messageIds.push(...detail.messages.map(({ id }) => id));
  }

  if (current.threadIds.length > 0) {
    chunks.push(current);
  }

  return chunks;
};

/**
 * A multi-row upsert cannot bind per-row values in its update clause, so the
 * conflict update reads each inserted column back from `excluded`. Only the
 * columns being written are named, so a column this write does not own keeps
 * its stored value.
 */
const excludedColumns = <TTable extends SQLiteTable>(
  table: TTable,
  rows: readonly InferInsertModel<TTable>[]
): Record<string, SQL> => {
  const columns = getColumns(table);

  return Object.fromEntries(
    Object.keys(rows[0] ?? {}).flatMap((key) => {
      const column = columns[key];

      return column === undefined
        ? []
        : [[key, sql`excluded.${sql.identifier(column.name)}`] as const];
    })
  );
};

const INBOX_LABEL_ID = LabelId.make("INBOX");
const SENT_LABEL_ID = LabelId.make("SENT");
const SPAM_LABEL_ID = LabelId.make("SPAM");
const TRASH_LABEL_ID = LabelId.make("TRASH");
const UNREAD_LABEL_ID = LabelId.make("UNREAD");

const setLabelMembership = (
  labels: readonly string[],
  label: string,
  applied: boolean
): readonly string[] => {
  if (applied) {
    return labels.includes(label) ? labels : [...labels, label];
  }

  return labels.filter((candidate) => candidate !== label);
};

type SystemMailbox = "inbox" | "spam";

const moveToSystemMailbox = (
  labels: readonly string[],
  mailbox: SystemMailbox
): readonly string[] => [
  ...labels.filter(
    (label) =>
      label !== SPAM_LABEL_ID &&
      label !== INBOX_LABEL_ID &&
      label !== TRASH_LABEL_ID
  ),
  mailbox === "inbox" ? INBOX_LABEL_ID : SPAM_LABEL_ID,
];

const updateThreadSystemMailbox = async (
  database: RemoteDatabaseClient,
  accountId: AccountId,
  threadId: ThreadId,
  mailbox: SystemMailbox
): Promise<void> => {
  const now = Date.now();

  await database.transaction(async (transaction) => {
    const messages = await transaction
      .select({
        labelIds: gmailMessages.labelIds,
        messageId: gmailMessages.messageId,
      })
      .from(gmailMessages)
      .where(
        and(
          eq(gmailMessages.accountEmail, accountId),
          eq(gmailMessages.threadId, threadId)
        )
      )
      .all();

    for (const message of messages) {
      // Gmail applies system-label moves to every message in the thread.
      // oxlint-disable-next-line eslint/no-await-in-loop
      await transaction
        .update(gmailMessages)
        .set({
          labelIds: moveToSystemMailbox(message.labelIds ?? [], mailbox),
          updatedAt: now,
        })
        .where(
          and(
            eq(gmailMessages.accountEmail, accountId),
            eq(gmailMessages.messageId, message.messageId)
          )
        )
        .run();
    }

    const [thread] = await transaction
      .select({ labels: gmailThreads.labels })
      .from(gmailThreads)
      .where(
        and(
          eq(gmailThreads.accountEmail, accountId),
          eq(gmailThreads.threadId, threadId)
        )
      )
      .limit(1)
      .all();

    if (thread === undefined) {
      return;
    }

    await transaction
      .update(gmailThreads)
      .set({
        isInInbox: mailbox === "inbox",
        isInSpam: mailbox === "spam",
        isInTrash: false,
        labels: moveToSystemMailbox(thread.labels ?? [], mailbox),
        spamAddedAt: mailbox === "spam" ? now : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(gmailThreads.accountEmail, accountId),
          eq(gmailThreads.threadId, threadId)
        )
      )
      .run();
  });

  forgetCachedCorrespondents(accountId);
};

/**
 * Bumped when the stored representation of a body changes, so rows written by
 * an older parser can be told apart and re-indexed rather than silently served.
 */
export const MESSAGE_SCHEMA_VERSION = 1;

const toAddresses = (mailboxes: readonly Mailbox[]): readonly string[] =>
  mailboxes.map((mailbox) => mailbox.address);

const toLabelValues = (
  accountId: string,
  label: GmailLabel,
  updatedAt: number
) => ({
  accountEmail: accountId,
  backgroundColor: label.color?.background ?? null,
  labelId: label.id,
  name: label.name,
  textColor: label.color?.text ?? null,
  type: label.type,
  updatedAt,
});

/**
 * `body_text` is stored uncompressed because `gmail_messages_fts` reads it as
 * external content; `body_html` is gzipped, which is where nearly all of the
 * bytes are. An HTML message still gets a text rendition so search matches it —
 * most mail is HTML, and indexing only `text/plain` parts would miss it.
 * Compression runs on the libuv pool so a large page never stalls Electron main.
 */
const toMessageValues = async (
  accountId: string,
  message: GmailMessage,
  now: number
) => {
  const isHtml = message.body.type === "html";
  const bodyHtml = isHtml
    ? await gzipAsync(Buffer.from(message.body.sanitizedHtml, "utf-8"))
    : null;

  return {
    accountEmail: accountId,
    attachments: message.attachments.map((attachment) => ({
      attachmentId: attachment.attachmentId,
      contentId: attachment.contentId,
      filename: attachment.filename,
      mediaType: attachment.mediaType,
      messageId: attachment.messageId,
      partId: attachment.partId,
      size: attachment.size,
    })),
    bccAddresses: toAddresses(message.bcc),
    bodyHtml,
    bodyText: isHtml
      ? toIndexText(message.body.sanitizedHtml)
      : message.body.text,
    ccAddresses: toAddresses(message.cc),
    fromAddress: message.from.address,
    fromName: message.from.name ?? null,
    hasBlockedRemoteImages: isHtml
      ? message.body.hasBlockedRemoteImages
      : false,
    internalDate: Number(message.sentAt),
    labelIds: [...message.labelIds],
    messageId: message.id,
    replyToAddress: message.replyTo?.address ?? null,
    schemaVersion: MESSAGE_SCHEMA_VERSION,
    subject: message.subject,
    threadId: message.threadId,
    toAddresses: toAddresses(message.to),
    updatedAt: now,
  };
};

const withDatabase = <A>(
  message: string,
  run: (database: RemoteDatabaseClient) => Promise<A>
) => withDatabaseClient(run).pipe(Effect.mapError(() => storeError(message)));

/**
 * Prepared before taking the connection so compression never holds it. Small
 * groups keep the synchronous text extraction from stalling main for a whole
 * page at once while still compressing in parallel.
 */
const MESSAGE_PREPARE_GROUP_SIZE = 16;

const prepareMessageValues = (
  accountId: string,
  messages: readonly GmailMessage[],
  now: number
) =>
  Effect.tryPromise({
    catch: () => storeError("Could not prepare Gmail messages"),
    try: async () => {
      const values: Awaited<ReturnType<typeof toMessageValues>>[] = [];

      for (
        let index = 0;
        index < messages.length;
        index += MESSAGE_PREPARE_GROUP_SIZE
      ) {
        const group = messages.slice(index, index + MESSAGE_PREPARE_GROUP_SIZE);
        // oxlint-disable-next-line eslint/no-await-in-loop
        const prepared = await Promise.all(
          group.map((message) => toMessageValues(accountId, message, now))
        );
        values.push(...prepared);
      }

      return values;
    },
  });

const decodeScopes = (raw: string): readonly GmailScope[] => {
  try {
    const parsed: unknown = JSON.parse(raw);

    return Array.isArray(parsed) ? parsed.filter(isGmailScope) : [];
  } catch {
    return [];
  }
};

const toGmailAccount = (row: {
  readonly avatarUrl: string | null;
  readonly displayName: string | null;
  readonly email: string;
  readonly scopes: string;
}): GmailAccount => {
  const scopes = decodeScopes(row.scopes);
  const account = {
    capabilities: getGmailCapabilities(scopes),
    email: row.email,
    id: AccountId.make(row.email),
    scopes,
  };
  const accountWithAvatar =
    row.avatarUrl === null ? account : { ...account, avatarUrl: row.avatarUrl };
  const accountWithProfile =
    row.displayName === null
      ? accountWithAvatar
      : { ...accountWithAvatar, displayName: row.displayName };

  return new GmailAccount(accountWithProfile);
};

export const GmailStoreLive = Layer.succeed(
  GmailStore,
  GmailStore.of({
    // Disconnecting must leave nothing behind, so every account-keyed mail
    // table is cleared here. Deleting the message rows also clears their FTS
    // entries, which the `gmail_messages_fts_delete` trigger handles.
    clearAccount: (accountId) =>
      withDatabase("Could not clear Gmail account data", async (database) => {
        await database.transaction(async (transaction) => {
          await transaction
            .delete(gmailThreads)
            .where(eq(gmailThreads.accountEmail, accountId))
            .run();
          await transaction
            .delete(gmailMessages)
            .where(eq(gmailMessages.accountEmail, accountId))
            .run();
          await transaction
            .delete(gmailLabels)
            .where(eq(gmailLabels.accountEmail, accountId))
            .run();
          await transaction
            .delete(gmailSyncState)
            .where(eq(gmailSyncState.accountEmail, accountId))
            .run();
          await transaction
            .delete(gmailBackfillState)
            .where(eq(gmailBackfillState.accountEmail, accountId))
            .run();
        });

        forgetCachedCorrespondents(accountId);
      }),

    deleteLabel: (accountId, label) =>
      withDatabase("Could not delete Gmail label", async (database) => {
        const now = Date.now();
        const remainingMessageLabelIds = sql`(
          SELECT json_group_array(value)
          FROM json_each(coalesce(${gmailMessages.labelIds}, '[]'))
          WHERE value <> ${label.id}
        )`;
        const messageHasLabel = sql`EXISTS (
          SELECT 1
          FROM json_each(coalesce(${gmailMessages.labelIds}, '[]'))
          WHERE value = ${label.id}
        )`;
        const remainingThreadLabels = sql`(
          SELECT json_group_array(value)
          FROM json_each(coalesce(${gmailThreads.labels}, '[]'))
          WHERE value <> ${label.name}
        )`;
        const threadHasLabel = sql`EXISTS (
          SELECT 1
          FROM json_each(coalesce(${gmailThreads.labels}, '[]'))
          WHERE value = ${label.name}
        )`;

        await database.transaction(async (transaction) => {
          await transaction
            .update(gmailMessages)
            .set({ labelIds: remainingMessageLabelIds, updatedAt: now })
            .where(
              and(eq(gmailMessages.accountEmail, accountId), messageHasLabel)
            )
            .run();
          await transaction
            .update(gmailThreads)
            .set({ labels: remainingThreadLabels, updatedAt: now })
            .where(
              and(eq(gmailThreads.accountEmail, accountId), threadHasLabel)
            )
            .run();
          await transaction
            .delete(gmailLabels)
            .where(
              and(
                eq(gmailLabels.accountEmail, accountId),
                eq(gmailLabels.labelId, label.id)
              )
            )
            .run();
        });
      }),

    /**
     * Credentials stay owned by `auth/auth.ts`, which refreshes directly with
     * Google. Reading an authorization therefore mints a live access token
     * rather than returning whatever was last persisted.
     */
    getAuthorization: (accountId) =>
      withDatabase("Could not load Gmail account", (database) =>
        database.query.googleAccounts.findFirst({ where: { email: accountId } })
      ).pipe(
        Effect.flatMap((row) =>
          row === undefined
            ? Effect.succeedNone
            : getGoogleAccessToken(accountId).pipe(
                // oxlint-disable-next-line promise/prefer-await-to-callbacks
                Effect.mapError((error) => storeError(error.message)),
                Effect.map((accessToken) =>
                  Option.some({
                    account: toGmailAccount(row),
                    credentials: {
                      accessToken: Redacted.make(accessToken, {
                        label: "Gmail access token",
                      }),
                    },
                  } satisfies GmailAuthorization)
                )
              )
        )
      ),

    getExistingThreadIds: (accountId, threadIds) =>
      withDatabase(
        "Could not inspect cached Gmail threads",
        async (database) => {
          if (threadIds.length === 0) {
            return [];
          }

          const existing: ThreadId[] = [];
          const chunkSize = 400;
          for (let index = 0; index < threadIds.length; index += chunkSize) {
            const chunk = threadIds.slice(index, index + chunkSize);
            // Keep each query below SQLite's bound-parameter limit.
            // oxlint-disable-next-line eslint/no-await-in-loop
            const rows = await database
              .select({ threadId: gmailThreads.threadId })
              .from(gmailThreads)
              .where(
                and(
                  eq(gmailThreads.accountEmail, accountId),
                  inArray(gmailThreads.threadId, [...chunk])
                )
              )
              .all();
            existing.push(...rows.map((row) => ThreadId.make(row.threadId)));
          }

          return existing;
        }
      ),

    getLabels: (accountId) =>
      withDatabase("Could not load Gmail labels", async (database) => {
        const rows = await database.query.gmailLabels.findMany({
          where: { accountEmail: accountId },
        });
        return rows.map((row) => {
          const label = {
            id: LabelId.make(row.labelId),
            name: row.name,
            type: row.type === "system" ? "system" : "user",
          } as const;

          return new GmailLabel(
            row.backgroundColor === null || row.textColor === null
              ? label
              : {
                  ...label,
                  color: new LabelColor({
                    background: row.backgroundColor,
                    text: row.textColor,
                  }),
                }
          );
        });
      }),

    getSyncCursor: (accountId) =>
      withDatabase("Could not load Gmail sync cursor", (database) =>
        database.query.gmailSyncState.findFirst({
          where: { accountEmail: accountId },
        })
      ).pipe(
        Effect.map((row) =>
          row === undefined
            ? Option.none()
            : Option.some(HistoryId.make(row.historyId))
        )
      ),

    /**
     * The Electron adapter reads its renderer-ready conversation from the
     * normalized message index. The generic Gmail service still has no cached
     * domain-thread representation because history ids and raw headers are not
     * persisted there, so its callers continue to fall through to the gateway.
     */
    getThread: () => Effect.succeedNone,

    listAccounts: withDatabase(
      "Could not load Gmail accounts",
      async (database) => {
        const rows = await database.query.googleAccounts.findMany();
        return rows.map(toGmailAccount);
      }
    ),

    moveThreadToInbox: (accountId, threadId) =>
      withDatabase("Could not move Gmail thread to the inbox", (database) =>
        updateThreadSystemMailbox(database, accountId, threadId, "inbox")
      ),

    moveThreadToSpam: (accountId, threadId) =>
      withDatabase("Could not move Gmail thread to spam", (database) =>
        updateThreadSystemMailbox(database, accountId, threadId, "spam")
      ),

    removeThreads: (accountId, threadIds) =>
      withDatabase("Could not remove Gmail threads", async (database) => {
        if (threadIds.length === 0) {
          return;
        }

        await database.transaction(async (transaction) => {
          await transaction
            .delete(gmailThreads)
            .where(
              and(
                eq(gmailThreads.accountEmail, accountId),
                inArray(gmailThreads.threadId, [...threadIds])
              )
            )
            .run();
          // Otherwise a permanently deleted thread would keep its bodies, and
          // its text would keep matching searches.
          await transaction
            .delete(gmailMessages)
            .where(
              and(
                eq(gmailMessages.accountEmail, accountId),
                inArray(gmailMessages.threadId, [...threadIds])
              )
            )
            .run();
        });
      }),

    replaceLabels: (accountId, labels) =>
      withDatabase("Could not save Gmail labels", async (database) => {
        const now = Date.now();

        await database
          .delete(gmailLabels)
          .where(eq(gmailLabels.accountEmail, accountId))
          .run();

        if (labels.length === 0) {
          return;
        }

        await database
          .insert(gmailLabels)
          .values(labels.map((label) => toLabelValues(accountId, label, now)))
          .run();
      }),

    /** Handled by `auth/auth.ts`; the gateway never emits a credential patch. */
    saveAuthorization: () => Effect.void,

    saveSyncCursor: (accountId, historyId) =>
      withDatabase("Could not save Gmail sync cursor", async (database) => {
        const now = Date.now();

        await database
          .insert(gmailSyncState)
          .values({
            accountEmail: accountId,
            historyId,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            set: { historyId, updatedAt: now },
            target: gmailSyncState.accountEmail,
          })
          .run();
      }),

    saveThread: (accountId, thread) => {
      const now = Date.now();

      return prepareMessageValues(accountId, thread.messages, now).pipe(
        Effect.flatMap((messageValues) =>
          withDatabase("Could not save Gmail thread", async (database) => {
            const isInSpam = thread.labelIds.includes(SPAM_LABEL_ID);
            const [firstMessage] = thread.messages;
            let latestMessage = firstMessage;

            for (const message of thread.messages) {
              if (
                latestMessage === undefined ||
                Number(message.sentAt) > Number(latestMessage.sentAt)
              ) {
                latestMessage = message;
              }
            }
            const attachments = thread.messages.flatMap((message) =>
              message.attachments.map((attachment) => ({
                attachmentId: attachment.attachmentId,
                filename: attachment.filename,
                mediaType: attachment.mediaType,
                messageId: attachment.messageId,
                partId: attachment.partId,
                size: attachment.size,
              }))
            );
            const labelRows = await database.query.gmailLabels.findMany({
              where: { accountEmail: accountId },
            });
            const namesById = new Map(
              labelRows.map((row) => [row.labelId, row.name] as const)
            );

            await database.transaction(async (transaction) => {
              await transaction
                .delete(gmailMessages)
                .where(
                  and(
                    eq(gmailMessages.accountEmail, accountId),
                    eq(gmailMessages.threadId, thread.id)
                  )
                )
                .run();

              for (const chunk of chunkRows(messageValues, gmailMessages)) {
                // Message writes must remain ordered within this transaction.
                // oxlint-disable-next-line eslint/no-await-in-loop
                await transaction
                  .insert(gmailMessages)
                  .values([...chunk])
                  .run();
              }

              await transaction
                .update(gmailThreads)
                .set({
                  attachments,
                  from: latestMessage?.from.address ?? "Unknown sender",
                  hasAttachments: attachments.length > 0,
                  isInInbox: thread.labelIds.includes(INBOX_LABEL_ID),
                  isInSent: thread.labelIds.includes(SENT_LABEL_ID),
                  isInSpam,
                  isInTrash: thread.labelIds.includes(TRASH_LABEL_ID),
                  isUnread: thread.messages.some((message) =>
                    message.labelIds.includes(LabelId.make("UNREAD"))
                  ),
                  labels: thread.labelIds.map(
                    (labelId) => namesById.get(labelId) ?? labelId
                  ),
                  latestAt: Number(latestMessage?.sentAt ?? 0),
                  messageCount: thread.messages.length,
                  spamAddedAt: isInSpam
                    ? sql`coalesce(${gmailThreads.spamAddedAt}, ${now})`
                    : null,
                  subject: thread.messages[0]?.subject ?? "(No subject)",
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(gmailThreads.accountEmail, accountId),
                    eq(gmailThreads.threadId, thread.id)
                  )
                )
                .run();
            });

            if (isInSpam) {
              forgetCachedCorrespondents(accountId);
            } else {
              rememberCorrespondentMessages(accountId, thread.messages);
            }
          })
        )
      );
    },

    setThreadLabel: (accountId, threadId, label, applied) =>
      withDatabase("Could not update Gmail thread labels", async (database) => {
        const now = Date.now();

        await database.transaction(async (transaction) => {
          const labelRows = await transaction
            .select({ labelId: gmailLabels.labelId, name: gmailLabels.name })
            .from(gmailLabels)
            .where(eq(gmailLabels.accountEmail, accountId))
            .all();
          const namesById = new Map([
            ...labelRows.map((row) => [row.labelId, row.name] as const),
            [label.id, label.name] as const,
          ]);
          const messageRows = await transaction
            .select({
              labelIds: gmailMessages.labelIds,
              messageId: gmailMessages.messageId,
            })
            .from(gmailMessages)
            .where(
              and(
                eq(gmailMessages.accountEmail, accountId),
                eq(gmailMessages.threadId, threadId)
              )
            )
            .all();
          const updatedMessageLabels = messageRows.map((row) => ({
            labelIds: setLabelMembership(row.labelIds ?? [], label.id, applied),
            messageId: row.messageId,
          }));

          for (const message of updatedMessageLabels) {
            // A Gmail thread label mutation applies to every message. Keep the
            // normalized cache in lockstep inside the same transaction.
            // oxlint-disable-next-line eslint/no-await-in-loop
            await transaction
              .update(gmailMessages)
              .set({ labelIds: message.labelIds, updatedAt: now })
              .where(
                and(
                  eq(gmailMessages.accountEmail, accountId),
                  eq(gmailMessages.messageId, message.messageId)
                )
              )
              .run();
          }

          const [cachedThread] = await transaction
            .select({ labels: gmailThreads.labels })
            .from(gmailThreads)
            .where(
              and(
                eq(gmailThreads.accountEmail, accountId),
                eq(gmailThreads.threadId, threadId)
              )
            )
            .limit(1)
            .all();

          if (cachedThread === undefined) {
            return;
          }

          const labels =
            updatedMessageLabels.length === 0
              ? setLabelMembership(
                  cachedThread.labels ?? [],
                  label.name,
                  applied
                )
              : [
                  ...new Set(
                    updatedMessageLabels.flatMap((message) => message.labelIds)
                  ),
                ].map((labelId) => namesById.get(labelId) ?? labelId);

          await transaction
            .update(gmailThreads)
            .set({
              labels,
              updatedAt: now,
            })
            .where(
              and(
                eq(gmailThreads.accountEmail, accountId),
                eq(gmailThreads.threadId, threadId)
              )
            )
            .run();
        });
      }),

    setThreadReadState: (accountId, threadId, isRead) =>
      withDatabase(
        "Could not update Gmail thread read state",
        async (database) => {
          const now = Date.now();

          await database.transaction(async (transaction) => {
            const messages = await transaction
              .select({
                labelIds: gmailMessages.labelIds,
                messageId: gmailMessages.messageId,
              })
              .from(gmailMessages)
              .where(
                and(
                  eq(gmailMessages.accountEmail, accountId),
                  eq(gmailMessages.threadId, threadId)
                )
              )
              .all();

            for (const message of messages) {
              // oxlint-disable-next-line eslint/no-await-in-loop
              await transaction
                .update(gmailMessages)
                .set({
                  labelIds: setLabelMembership(
                    message.labelIds ?? [],
                    UNREAD_LABEL_ID,
                    !isRead
                  ),
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(gmailMessages.accountEmail, accountId),
                    eq(gmailMessages.messageId, message.messageId)
                  )
                )
                .run();
            }

            await transaction
              .update(gmailThreads)
              .set({ isUnread: !isRead, updatedAt: now })
              .where(
                and(
                  eq(gmailThreads.accountEmail, accountId),
                  eq(gmailThreads.threadId, threadId)
                )
              )
              .run();
          });
        }
      ),

    /** See `saveAuthorization`. */
    updateCredentials: () => Effect.void,

    updateLabel: (accountId, previous, updated) =>
      withDatabase("Could not update Gmail label", async (database) => {
        const now = Date.now();

        await database.transaction(async (transaction) => {
          if (previous.name !== updated.name) {
            const renamedThreadLabels = sql`(
              SELECT json_group_array(
                CASE WHEN value = ${previous.name} THEN ${updated.name} ELSE value END
              )
              FROM json_each(coalesce(${gmailThreads.labels}, '[]'))
            )`;
            const threadHasLabel = sql`EXISTS (
              SELECT 1
              FROM json_each(coalesce(${gmailThreads.labels}, '[]'))
              WHERE value = ${previous.name}
            )`;

            await transaction
              .update(gmailThreads)
              .set({ labels: renamedThreadLabels, updatedAt: now })
              .where(
                and(eq(gmailThreads.accountEmail, accountId), threadHasLabel)
              )
              .run();
          }

          await transaction
            .update(gmailLabels)
            .set({
              backgroundColor: updated.color?.background ?? null,
              name: updated.name,
              textColor: updated.color?.text ?? null,
              type: updated.type,
              updatedAt: now,
            })
            .where(
              and(
                eq(gmailLabels.accountEmail, accountId),
                eq(gmailLabels.labelId, previous.id)
              )
            )
            .run();
        });
      }),

    upsertLabels: (accountId, labels) =>
      withDatabase("Could not save Gmail labels", async (database) => {
        if (labels.length === 0) {
          return;
        }

        const now = Date.now();
        await database
          .insert(gmailLabels)
          .values(labels.map((label) => toLabelValues(accountId, label, now)))
          .onConflictDoUpdate({
            set: {
              backgroundColor: sql`excluded.background_color`,
              name: sql`excluded.name`,
              textColor: sql`excluded.text_color`,
              type: sql`excluded.type`,
              updatedAt: now,
            },
            target: [gmailLabels.accountEmail, gmailLabels.labelId],
          })
          .run();
      }),

    upsertThreadDetails: (accountId, threads, details) => {
      if (threads.length === 0 && details.length === 0) {
        return Effect.void;
      }

      const now = Date.now();

      return prepareMessageValues(
        accountId,
        details.flatMap(({ messages }) => messages),
        now
      ).pipe(
        Effect.flatMap((messageValues) =>
          withDatabase("Could not save Gmail threads", async (database) => {
            // The cached row stores label *names*: the renderer renders this
            // column directly as badges, and `listCachedThreadPage` filters the
            // inbox on it. System label ids double as their names, so an
            // unknown id (a label created since the last catalog refresh)
            // falls back to the id.
            const labelRows = await database.query.gmailLabels.findMany({
              where: { accountEmail: accountId },
            });
            const namesById = new Map(
              labelRows.map((row) => [row.labelId, row.name] as const)
            );
            const threadValues = threads.map((thread) => {
              const isInSpam = thread.labelIds.includes(SPAM_LABEL_ID);

              return {
                accountEmail: accountId,
                attachments: thread.attachments.map((attachment) => ({
                  attachmentId: attachment.attachmentId,
                  filename: attachment.filename,
                  mediaType: attachment.mediaType,
                  messageId: attachment.messageId,
                  partId: attachment.partId,
                  size: attachment.size,
                })),
                // `participants[0]` is the newest message's sender.
                from: thread.participants[0]?.address ?? "Unknown sender",
                hasAttachments: thread.hasAttachments,
                // Read off the label *ids*, not the mapped names above: the
                // mapping falls back to the id for unknown labels, so a stale
                // catalog would otherwise be able to change what counts as
                // inbox.
                isInInbox: thread.labelIds.includes(INBOX_LABEL_ID),
                isInSent: thread.labelIds.includes(SENT_LABEL_ID),
                isInSpam,
                isInTrash: thread.labelIds.includes(TRASH_LABEL_ID),
                isIndexSeen: true,
                isUnread: thread.hasUnread,
                labels: thread.labelIds.map(
                  (labelId) => namesById.get(labelId) ?? labelId
                ),
                latestAt: Number(thread.latestAt),
                messageCount: thread.messageCount,
                snippet: thread.snippet,
                spamAddedAt: isInSpam ? now : null,
                subject: thread.subject,
                threadId: thread.id,
                updatedAt: now,
              };
            });

            // One transaction for the whole page: a crash mid-page must not
            // leave a thread row claiming messages that were never written.
            // The indexer advances its checkpoint only after this transaction
            // succeeds, so a crash between the two safely replays the page.
            await database.transaction(async (transaction) => {
              for (const chunk of chunkRows(threadValues, gmailThreads)) {
                // Page writes must remain ordered within this transaction.
                // oxlint-disable-next-line eslint/no-await-in-loop
                await transaction
                  .insert(gmailThreads)
                  .values([...chunk])
                  .onConflictDoUpdate({
                    set: {
                      ...excludedColumns(gmailThreads, chunk),
                      // Preserve the first local SPAM transition across later
                      // history refreshes; leaving Spam clears it, so a future
                      // transition receives a fresh timestamp.
                      spamAddedAt: sql`CASE
                        WHEN excluded.is_in_spam = 0 THEN NULL
                        WHEN ${gmailThreads.isInSpam} = 1 THEN ${gmailThreads.spamAddedAt}
                        ELSE excluded.spam_added_at
                      END`,
                    },
                    target: [gmailThreads.accountEmail, gmailThreads.threadId],
                  })
                  .run();
              }

              // A full Gmail thread is authoritative for message membership.
              // Do not do this for an unparsed detail: a malformed MIME payload
              // must not erase previously usable cached bodies. Batching several
              // threads can only keep a row that moved between two of them, and
              // the upsert below rewrites that row with its current thread.
              for (const chunk of chunkDetailMembership(details)) {
                // Page writes must remain ordered within this transaction.
                // oxlint-disable-next-line eslint/no-await-in-loop
                await transaction
                  .delete(gmailMessages)
                  .where(
                    and(
                      eq(gmailMessages.accountEmail, accountId),
                      inArray(gmailMessages.threadId, chunk.threadIds),
                      chunk.messageIds.length === 0
                        ? undefined
                        : notInArray(gmailMessages.messageId, chunk.messageIds)
                    )
                  )
                  .run();
              }

              for (const chunk of chunkRows(messageValues, gmailMessages)) {
                // Page writes must remain ordered within this transaction.
                // oxlint-disable-next-line eslint/no-await-in-loop
                await transaction
                  .insert(gmailMessages)
                  .values([...chunk])
                  .onConflictDoUpdate({
                    set: excludedColumns(gmailMessages, chunk),
                    target: [
                      gmailMessages.accountEmail,
                      gmailMessages.messageId,
                    ],
                  })
                  .run();
              }
            });

            if (
              threads.some((thread) => thread.labelIds.includes(SPAM_LABEL_ID))
            ) {
              forgetCachedCorrespondents(accountId);
            } else {
              rememberCorrespondentMessages(
                accountId,
                details.flatMap(({ messages }) => messages)
              );
            }
          })
        )
      );
    },
  })
);
