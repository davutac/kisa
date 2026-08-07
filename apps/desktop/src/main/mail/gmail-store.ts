import type { DatabaseClient } from "@repo/database/client";
import {
  gmailLabels,
  gmailSyncState,
  gmailThreads,
  googleAccounts,
} from "@repo/database/schemas";
import { GmailStoreError } from "@repo/gmail/errors";
import type { GmailAuthorization, GmailScope } from "@repo/gmail/models";
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

const GMAIL_SCOPES = new Set<string>([
  GMAIL_MODIFY_SCOPE,
  GMAIL_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
]);

const storeError = (message: string) => new GmailStoreError({ message });

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
    clearAccount: (accountId) =>
      withDatabase("Could not clear Gmail account data", (database) => {
        database
          .delete(gmailThreads)
          .where(eq(gmailThreads.accountEmail, accountId))
          .run();
        database
          .delete(gmailLabels)
          .where(eq(gmailLabels.accountEmail, accountId))
          .run();
        database
          .delete(gmailSyncState)
          .where(eq(gmailSyncState.accountEmail, accountId))
          .run();
      }),

    /**
     * Credentials stay owned by `auth/auth.ts`, which refreshes through the
     * auth worker. Reading an authorization therefore mints a live access
     * token rather than returning whatever was last persisted.
     */
    getAuthorization: (accountId) =>
      withDatabase("Could not load Gmail account", (database) =>
        database.query.googleAccounts
          .findFirst({ where: eq(googleAccounts.email, accountId) })
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
          .findMany({ where: eq(gmailLabels.accountEmail, accountId) })
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
          .findFirst({ where: eq(gmailSyncState.accountEmail, accountId) })
          .sync()
      ).pipe(
        Effect.map((row) =>
          row === undefined
            ? Option.none()
            : Option.some(HistoryId.make(row.historyId))
        )
      ),

    /**
     * Message bodies are not cached; the hand-rolled sync always refetched a
     * thread on open and this keeps that behaviour. `GmailService.getThread`
     * treats `None` as "go to the network".
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

        database
          .delete(gmailThreads)
          .where(
            and(
              eq(gmailThreads.accountEmail, accountId),
              inArray(gmailThreads.threadId, [...threadIds])
            )
          )
          .run();
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

    /** See `getThread`: bodies are not cached. */
    saveThread: () => Effect.void,

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

    upsertThreadSummaries: (accountId, threads) =>
      withDatabase("Could not save Gmail threads", (database) => {
        if (threads.length === 0) {
          return;
        }

        const now = Date.now();
        // The cached row stores label *names*: the renderer renders this column
        // directly as badges, and `listCachedThreadPage` filters the inbox on
        // it. System label ids double as their names, so an unknown id (a label
        // created since the last catalog refresh) falls back to the id.
        const namesById = new Map(
          database.query.gmailLabels
            .findMany({ where: eq(gmailLabels.accountEmail, accountId) })
            .sync()
            .map((row) => [row.labelId, row.name] as const)
        );

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

          database
            .insert(gmailThreads)
            .values(values)
            .onConflictDoUpdate({
              set: values,
              target: [gmailThreads.accountEmail, gmailThreads.threadId],
            })
            .run();
        }
      }),
  })
);
