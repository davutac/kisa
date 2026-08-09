import { gzipSync } from "node:zlib";

import type { DatabaseClient } from "@repo/database/client";
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
  Mailbox,
} from "@repo/gmail/models";
import {
  AccountId,
  GmailAccount,
  GmailCapabilities,
  GmailLabel,
  GMAIL_MODIFY_SCOPE,
  GMAIL_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
  HistoryId,
  LabelId,
} from "@repo/gmail/models";
import { GmailStore } from "@repo/gmail/store";
import { and, eq, inArray } from "drizzle-orm";
import { Effect, Layer, Option, Redacted } from "effect";

import { getGoogleAccessToken } from "../auth/auth";
import { getDatabaseClient } from "../database";
import { toIndexText } from "./message-text";

const GMAIL_SCOPES = new Set<string>([
  GMAIL_MODIFY_SCOPE,
  GMAIL_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
]);

const storeError = (message: string) => new GmailStoreError({ message });

const INBOX_LABEL_ID = LabelId.make("INBOX");

/**
 * Bumped when the stored representation of a body changes, so rows written by
 * an older parser can be told apart and re-indexed rather than silently served.
 */
export const MESSAGE_SCHEMA_VERSION = 1;

const toAddresses = (mailboxes: readonly Mailbox[]): readonly string[] =>
  mailboxes.map((mailbox) => mailbox.address);

/**
 * `body_text` is stored uncompressed because `gmail_messages_fts` reads it as
 * external content; `body_html` is gzipped, which is where nearly all of the
 * bytes are. An HTML message still gets a text rendition so search matches it —
 * most mail is HTML, and indexing only `text/plain` parts would miss it.
 */
const toMessageValues = (
  accountId: string,
  message: GmailMessage,
  now: number
) => {
  const isHtml = message.body.type === "html";

  return {
    accountEmail: accountId,
    attachments: message.attachments.map((attachment) => ({
      attachmentId: attachment.attachmentId,
      contentId: attachment.contentId,
      filename: attachment.filename,
      mediaType: attachment.mediaType,
      messageId: attachment.messageId,
      size: attachment.size,
    })),
    bccAddresses: toAddresses(message.bcc),
    bodyHtml: isHtml
      ? gzipSync(Buffer.from(message.body.sanitizedHtml, "utf-8"))
      : null,
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
  run: (database: DatabaseClient) => A
) =>
  getDatabaseClient().pipe(
    // oxlint-disable-next-line promise/prefer-await-to-callbacks
    Effect.mapError((error) => storeError(error.message)),
    Effect.flatMap((database) =>
      Effect.try({ catch: () => storeError(message), try: () => run(database) })
    )
  );

const decodeScopes = (raw: string): readonly GmailScope[] => {
  try {
    const parsed: unknown = JSON.parse(raw);

    return Array.isArray(parsed)
      ? parsed.filter(
          (scope): scope is GmailScope =>
            typeof scope === "string" && GMAIL_SCOPES.has(scope)
        )
      : [];
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
  const canModify = scopes.includes(GMAIL_MODIFY_SCOPE);

  return new GmailAccount({
    capabilities: new GmailCapabilities({
      modify: canModify,
      read: canModify || scopes.includes(GMAIL_READONLY_SCOPE),
      send: canModify || scopes.includes(GMAIL_SEND_SCOPE),
    }),
    email: row.email,
    id: AccountId.make(row.email),
    scopes,
    ...(row.avatarUrl === null ? {} : { avatarUrl: row.avatarUrl }),
    ...(row.displayName === null ? {} : { displayName: row.displayName }),
  });
};

export const GmailStoreLive = Layer.succeed(
  GmailStore,
  GmailStore.of({
    // Disconnecting must leave nothing behind, so every account-keyed mail
    // table is cleared here. Deleting the message rows also clears their FTS
    // entries, which the `gmail_messages_fts_delete` trigger handles.
    clearAccount: (accountId) =>
      withDatabase("Could not clear Gmail account data", (database) => {
        database.transaction((transaction) => {
          transaction
            .delete(gmailThreads)
            .where(eq(gmailThreads.accountEmail, accountId))
            .run();
          transaction
            .delete(gmailMessages)
            .where(eq(gmailMessages.accountEmail, accountId))
            .run();
          transaction
            .delete(gmailLabels)
            .where(eq(gmailLabels.accountEmail, accountId))
            .run();
          transaction
            .delete(gmailSyncState)
            .where(eq(gmailSyncState.accountEmail, accountId))
            .run();
          transaction
            .delete(gmailBackfillState)
            .where(eq(gmailBackfillState.accountEmail, accountId))
            .run();
        });
      }),

    /**
     * Credentials stay owned by `auth/auth.ts`, which refreshes through the
     * auth worker. Reading an authorization therefore mints a live access
     * token rather than returning whatever was last persisted.
     */
    getAuthorization: (accountId) =>
      withDatabase("Could not load Gmail account", (database) =>
        database.query.googleAccounts
          .findFirst({ where: { email: accountId } })
          .sync()
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

    getLabels: (accountId) =>
      withDatabase("Could not load Gmail labels", (database) =>
        database.query.gmailLabels
          .findMany({ where: { accountEmail: accountId } })
          .sync()
          .map(
            (row) =>
              new GmailLabel({
                id: LabelId.make(row.labelId),
                name: row.name,
                type: row.type === "system" ? "system" : "user",
              })
          )
      ),

    getSyncCursor: (accountId) =>
      withDatabase("Could not load Gmail sync cursor", (database) =>
        database.query.gmailSyncState
          .findFirst({ where: { accountEmail: accountId } })
          .sync()
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

    listAccounts: withDatabase("Could not load Gmail accounts", (database) =>
      database.query.googleAccounts.findMany().sync().map(toGmailAccount)
    ),

    removeThreads: (accountId, threadIds) =>
      withDatabase("Could not remove Gmail threads", (database) => {
        if (threadIds.length === 0) {
          return;
        }

        database.transaction((transaction) => {
          transaction
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
          transaction
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
      withDatabase("Could not save Gmail labels", (database) => {
        const now = Date.now();

        database
          .delete(gmailLabels)
          .where(eq(gmailLabels.accountEmail, accountId))
          .run();

        if (labels.length === 0) {
          return;
        }

        database
          .insert(gmailLabels)
          .values(
            labels.map((label) => ({
              accountEmail: accountId,
              labelId: label.id,
              name: label.name,
              type: label.type,
              updatedAt: now,
            }))
          )
          .run();
      }),

    /** Handled by `auth/auth.ts`; the gateway never emits a credential patch. */
    saveAuthorization: () => Effect.void,

    saveSyncCursor: (accountId, historyId) =>
      withDatabase("Could not save Gmail sync cursor", (database) => {
        const now = Date.now();

        database
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

    saveThread: (accountId, thread) =>
      withDatabase("Could not save Gmail thread", (database) => {
        const now = Date.now();
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
            size: attachment.size,
          }))
        );
        const namesById = new Map(
          database.query.gmailLabels
            .findMany({ where: { accountEmail: accountId } })
            .sync()
            .map((row) => [row.labelId, row.name] as const)
        );

        database.transaction((transaction) => {
          transaction
            .delete(gmailMessages)
            .where(
              and(
                eq(gmailMessages.accountEmail, accountId),
                eq(gmailMessages.threadId, thread.id)
              )
            )
            .run();

          for (const message of thread.messages) {
            transaction
              .insert(gmailMessages)
              .values(toMessageValues(accountId, message, now))
              .run();
          }

          transaction
            .update(gmailThreads)
            .set({
              attachments,
              from: latestMessage?.from.address ?? "Unknown sender",
              hasAttachments: attachments.length > 0,
              isInInbox: thread.labelIds.includes(INBOX_LABEL_ID),
              isUnread: thread.messages.some((message) =>
                message.labelIds.includes(LabelId.make("UNREAD"))
              ),
              labels: thread.labelIds.map(
                (labelId) => namesById.get(labelId) ?? labelId
              ),
              latestAt: Number(latestMessage?.sentAt ?? 0),
              messageCount: thread.messages.length,
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
      }),

    setThreadReadState: (accountId, threadId, isRead) =>
      withDatabase("Could not update Gmail thread read state", (database) => {
        database
          .update(gmailThreads)
          .set({ isUnread: !isRead, updatedAt: Date.now() })
          .where(
            and(
              eq(gmailThreads.accountEmail, accountId),
              eq(gmailThreads.threadId, threadId)
            )
          )
          .run();
      }),

    /** See `saveAuthorization`. */
    updateCredentials: () => Effect.void,

    upsertThreadDetails: (accountId, threads, details) =>
      withDatabase("Could not save Gmail threads", (database) => {
        if (threads.length === 0 && details.length === 0) {
          return;
        }

        const now = Date.now();
        // The cached row stores label *names*: the renderer renders this column
        // directly as badges, and `listCachedThreadPage` filters the inbox on
        // it. System label ids double as their names, so an unknown id (a label
        // created since the last catalog refresh) falls back to the id.
        const namesById = new Map(
          database.query.gmailLabels
            .findMany({ where: { accountEmail: accountId } })
            .sync()
            .map((row) => [row.labelId, row.name] as const)
        );

        // One transaction for the whole page: a crash mid-page must not leave a
        // thread row claiming messages that were never written, and it is what
        // makes the indexer's per-page checkpoint atomic.
        database.transaction((transaction) => {
          for (const thread of threads) {
            const values = {
              accountEmail: accountId,
              attachments: thread.attachments.map((attachment) => ({
                attachmentId: attachment.attachmentId,
                filename: attachment.filename,
                mediaType: attachment.mediaType,
                messageId: attachment.messageId,
                size: attachment.size,
              })),
              // `participants[0]` is the newest message's sender.
              from: thread.participants[0]?.address ?? "Unknown sender",
              hasAttachments: thread.hasAttachments,
              // Read off the label *ids*, not the mapped names above: the
              // mapping falls back to the id for unknown labels, so a stale
              // catalog would otherwise be able to change what counts as inbox.
              isInInbox: thread.labelIds.includes(INBOX_LABEL_ID),
              isUnread: thread.hasUnread,
              labels: thread.labelIds.map(
                (labelId) => namesById.get(labelId) ?? labelId
              ),
              latestAt: Number(thread.latestAt),
              messageCount: thread.messageCount,
              snippet: thread.snippet,
              subject: thread.subject,
              threadId: thread.id,
              updatedAt: now,
            };

            transaction
              .insert(gmailThreads)
              .values(values)
              .onConflictDoUpdate({
                set: values,
                target: [gmailThreads.accountEmail, gmailThreads.threadId],
              })
              .run();
          }

          for (const detail of details) {
            for (const message of detail.messages) {
              const values = toMessageValues(accountId, message, now);

              transaction
                .insert(gmailMessages)
                .values(values)
                .onConflictDoUpdate({
                  set: values,
                  target: [gmailMessages.accountEmail, gmailMessages.messageId],
                })
                .run();
            }
          }
        });
      }),
  })
);
