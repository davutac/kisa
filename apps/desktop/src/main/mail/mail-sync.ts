import { readFile, stat } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import { gmailThreads } from "@repo/database/schemas";
import type { gmailMessages } from "@repo/database/schemas";
import type { GmailError } from "@repo/gmail/errors";
import { GmailGateway } from "@repo/gmail/gateway";
import { GmailMime } from "@repo/gmail/mime";
import type {
  GmailLabel,
  GmailThread as GmailDomainThread,
  Mailbox,
} from "@repo/gmail/models";
import { AccountId, LabelId, MessageId, ThreadId } from "@repo/gmail/models";
import { Gmail } from "@repo/gmail/service";
import { GmailStore } from "@repo/gmail/store";
import { and as andSql, eq, inArray as inArraySql } from "drizzle-orm";
import { Clock, Effect, Layer, Schedule, Schema } from "effect";

import {
  MAIL_SYNC_STATUS_CHANNEL,
  MAIL_THREAD_LIST_UPDATED_CHANNEL,
  MAIL_THREAD_UPDATED_CHANNEL,
} from "../../shared/ipc/channels";
import {
  GmailSyncStatus,
  GmailThreadListUpdated,
  GmailThreadUpdated,
  MAX_GMAIL_ATTACHMENT_BYTES,
} from "../../shared/ipc/mail";
import type {
  GmailCachedThreadPage,
  GmailCachedThreadPageRequest,
  GmailLabelCatalog,
  GmailLabelCatalogRequest,
  GmailLabelSummary,
  GmailMessageSendRequest,
  GmailSenderBrand,
  GmailThread as GmailThreadDto,
  GmailThreadMessage,
  GmailThreadMessageSendRequest,
  GmailThreadReadStateRequest,
  GmailThreadRequest,
  GmailThreadListChange,
  GmailThreadSummary,
} from "../../shared/ipc/mail";
import { withDatabaseClient } from "../database";
import { sendRendererEvent } from "../electron/renderer-events";
import { GmailGatewayLive } from "./gmail-gateway";
import { GmailMimeLive } from "./gmail-mime";
import { parseMailbox } from "./gmail-payload";
import { GmailStoreLive, MESSAGE_SCHEMA_VERSION } from "./gmail-store";
import {
  inlineImageDataUrls,
  normalizeContentId,
  selectInlineImages,
  toImageDataUrl,
} from "./inline-images";
import type { NewMailNotificationMessage } from "./new-mail-notifications";
import {
  dismissThreadNotifications,
  showNewMailNotifications,
} from "./new-mail-notifications";
import { addUnreadLabel, removeUnreadLabel } from "./read-state";
import type { MessageHeader } from "./sender-brand";
import { getSenderBrand, hasCachedSenderBrand } from "./sender-brand";
import { getThreadCacheState } from "./thread-cache-policy";
import { refreshUnreadBadge } from "./unread-badge";

const GMAIL_INBOX_LABEL = "INBOX";
const GMAIL_TRASH_LABEL = "TRASH";
const GMAIL_READ_SCOPES = new Set([
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.readonly",
]);
const THREAD_PAGE_SIZE = 50;
const INLINE_IMAGE_CONCURRENCY = 3;
const POLL_INTERVAL_MS = 15_000;
const MAX_SYNC_RETRIES = 5;

// oxlint-disable-next-line unicorn/throw-new-error
class MailSyncError extends Schema.TaggedErrorClass<MailSyncError>()(
  "MailSyncError",
  {
    message: Schema.String,
    retryable: Schema.optional(Schema.Boolean),
    status: Schema.optional(Schema.Int),
  }
) {}

/**
 * `packages/gmail` owns the Gmail domain; this module is the Electron adapter
 * around it. The dependency layers are merged into the output so `getThread`
 * can reach the gateway and MIME service directly — reading a thread needs the
 * raw headers for BIMI discovery, which the parsed domain model does not carry.
 */
const GmailLive = Gmail.layerWithoutDependencies.pipe(
  Layer.provideMerge(
    Layer.mergeAll(GmailStoreLive, GmailGatewayLive, GmailMimeLive)
  )
);

type GmailServices = Gmail | GmailGateway | GmailMime | GmailStore;

const isRetryableGmailError = (error: GmailError): boolean =>
  error._tag === "GmailRateLimitError" ||
  (error._tag === "GmailApiError" && error.retryable);

const toMailSyncError = (error: GmailError): MailSyncError =>
  new MailSyncError({
    message: error.message,
    retryable: isRetryableGmailError(error),
  });

/**
 * The layer is rebuilt per call rather than held in a `ManagedRuntime`, so the
 * per-account semaphore inside `GmailService` does not span calls. Request
 * concurrency is already bounded below it (thread fetches at 5 in the gateway)
 * and above it (two accounts at a time in the poll loop).
 */
const runGmail = <A, E extends GmailError>(
  effect: Effect.Effect<A, E, GmailServices>
): Effect.Effect<A, MailSyncError> =>
  effect.pipe(Effect.provide(GmailLive), Effect.mapError(toMailSyncError));

const withDatabase = <A>(
  message: string,
  run: (database: RemoteDatabaseClient) => Promise<A>
) =>
  withDatabaseClient(run).pipe(
    Effect.mapError(() => new MailSyncError({ message }))
  );

type CachedThreadRow = typeof gmailThreads.$inferSelect;

const toCachedThreadSummary = (row: CachedThreadRow): GmailThreadSummary => {
  const attachments = row.attachments ?? [];

  return {
    accountId: row.accountEmail,
    attachments,
    from: row.from,
    hasAttachments: row.hasAttachments ?? attachments.length > 0,
    isUnread: row.isUnread,
    labels: row.labels ?? [],
    latestAt: row.latestAt,
    messageCount: row.messageCount,
    snippet: row.snippet,
    subject: row.subject,
    threadId: row.threadId,
  };
};

type CachedMessageRow = typeof gmailMessages.$inferSelect;

interface CachedConversation {
  readonly cachedAt: number;
  readonly isUnread: boolean;
  readonly thread: GmailThreadDto;
}

const formatCachedAddresses = (addresses: readonly string[] | null): string =>
  (addresses ?? []).join(", ");

const toCachedThreadMessage = (
  row: CachedMessageRow
): GmailThreadMessage | undefined => {
  let body: GmailThreadMessage["body"];

  try {
    body =
      row.bodyHtml === null
        ? { text: row.bodyText ?? "" }
        : { html: gunzipSync(row.bodyHtml).toString("utf-8") };
  } catch {
    return;
  }

  const bcc = formatCachedAddresses(row.bccAddresses);
  const cc = formatCachedAddresses(row.ccAddresses);
  const to = formatCachedAddresses(row.toAddresses);

  return {
    attachments: (row.attachments ?? []).map((attachment) => ({
      attachmentId: attachment.attachmentId,
      filename: attachment.filename,
      mediaType: attachment.mediaType,
      messageId: attachment.messageId,
      size: attachment.size,
    })),
    body,
    from: row.fromAddress,
    id: row.messageId,
    labelIds: removeUnreadLabel(row.labelIds ?? []),
    sentAt: row.internalDate,
    snippet: "",
    subject: row.subject.length === 0 ? "(No subject)" : row.subject,
    ...(bcc.length === 0 ? {} : { bcc }),
    ...(cc.length === 0 ? {} : { cc }),
    ...(row.replyToAddress === null ? {} : { replyTo: row.replyToAddress }),
    ...(to.length === 0 ? {} : { to }),
  };
};

const readCachedConversation = Effect.fn("readCachedConversation")(
  function* readCachedConversation(request: GmailThreadRequest) {
    return yield* withDatabase(
      "Could not load cached email",
      async (database) => {
        const threadRow = await database.query.gmailThreads.findFirst({
          where: {
            accountEmail: request.accountId,
            threadId: request.threadId,
          },
        });

        if (threadRow === undefined) {
          return;
        }

        const messageRows = await database.query.gmailMessages.findMany({
          orderBy: { internalDate: "asc" },
          where: {
            accountEmail: request.accountId,
            threadId: request.threadId,
          },
        });

        if (
          messageRows.length === 0 ||
          messageRows.length !== threadRow.messageCount ||
          messageRows.some(
            (row) => row.schemaVersion !== MESSAGE_SCHEMA_VERSION
          )
        ) {
          return;
        }

        const messages = messageRows.map(toCachedThreadMessage);

        if (messages.some((message) => message === undefined)) {
          return;
        }

        const completeMessages = messages as readonly GmailThreadMessage[];

        return {
          cachedAt: Math.min(
            ...messageRows.map((message) => message.updatedAt)
          ),
          isUnread: threadRow.isUnread,
          thread: {
            accountId: request.accountId,
            labels: threadRow.labels ?? [],
            messages: completeMessages,
            subject: completeMessages[0]?.subject ?? "(No subject)",
            threadId: request.threadId,
          },
        } satisfies CachedConversation;
      }
    );
  }
);

export const listCachedThreadPage = Effect.fn("listCachedThreadPage")(
  function* listCachedThreadPage(request: GmailCachedThreadPageRequest) {
    if (request.accountIds.length === 0) {
      return { threads: [] } satisfies GmailCachedThreadPage;
    }

    const rows = yield* withDatabase("Could not load email", (database) =>
      database.query.gmailThreads.findMany({
        limit: THREAD_PAGE_SIZE + 1,
        // SQL ordering follows insertion order, so these keys are semantic.
        // oxlint-disable-next-line eslint/sort-keys
        orderBy: {
          latestAt: "desc",
          accountEmail: "asc",
          threadId: "asc",
        },
        where: {
          accountEmail: { in: [...request.accountIds] },
          // The inbox predicate has to be in SQL, not a filter over the
          // page below: the index stores archived mail in this table too,
          // so filtering afterwards would return near-empty pages while
          // paging through everything the user archived.
          isInInbox: true,
          ...(request.unreadOnly === true ? { isUnread: true } : {}),
          ...(request.cursor === undefined
            ? {}
            : {
                OR: [
                  { latestAt: { lt: request.cursor.latestAt } },
                  {
                    accountEmail: { gt: request.cursor.accountId },
                    latestAt: request.cursor.latestAt,
                  },
                  {
                    accountEmail: request.cursor.accountId,
                    latestAt: request.cursor.latestAt,
                    threadId: { gt: request.cursor.threadId },
                  },
                ],
              }),
        },
      })
    );
    const pageRows = rows.slice(0, THREAD_PAGE_SIZE);
    const threads = pageRows.map(toCachedThreadSummary);
    const lastRow = pageRows.at(-1);

    return rows.length > THREAD_PAGE_SIZE && lastRow !== undefined
      ? {
          nextCursor: {
            accountId: lastRow.accountEmail,
            latestAt: lastRow.latestAt,
            threadId: lastRow.threadId,
          },
          threads,
        }
      : { threads };
  }
);

const notifyThreadListUpdated = (
  changes: readonly GmailThreadListChange[]
): void => {
  sendRendererEvent(MAIL_THREAD_LIST_UPDATED_CHANNEL, GmailThreadListUpdated, {
    changes,
  });
};

const syncingAccountIds = new Set<string>();

const setAccountSyncing = (accountId: string, isSyncing: boolean): void => {
  if (isSyncing) {
    syncingAccountIds.add(accountId);
  } else {
    syncingAccountIds.delete(accountId);
  }

  sendRendererEvent(MAIL_SYNC_STATUS_CHANNEL, GmailSyncStatus, {
    accountIds: [...syncingAccountIds],
  });
};

const publishThreadListUpdated = Effect.fn("publishThreadListUpdated")(
  function* publishThreadListUpdated(
    changes: readonly GmailThreadListChange[]
  ) {
    yield* Effect.try({
      catch: () =>
        new MailSyncError({ message: "Could not publish email update" }),
      try: () => notifyThreadListUpdated(changes),
    });
    yield* refreshUnreadBadge().pipe(
      Effect.catch((error) =>
        Effect.logWarning(`Could not refresh unread badge: ${error.message}`)
      )
    );
  }
);

const reloadThreadList = (accountId: string) =>
  publishThreadListUpdated([{ accountId, kind: "reload" }]);

// Disconnecting an account must leave nothing behind, and every mail table is
// keyed by the account address, so deleting by it clears the account entirely.
export const forgetAccountMailData = Effect.fn("forgetAccountMailData")(
  function* forgetAccountMailData(accountId: string) {
    yield* runGmail(
      GmailStore.pipe(
        Effect.flatMap((store) => store.clearAccount(AccountId.make(accountId)))
      )
    );

    if (syncingAccountIds.has(accountId)) {
      setAccountSyncing(accountId, false);
    }

    yield* refreshUnreadBadge().pipe(
      Effect.catch((error) =>
        Effect.logWarning(`Could not refresh unread badge: ${error.message}`)
      )
    );
  }
);

const toGmailLabelSummary = (label: GmailLabel): GmailLabelSummary => ({
  ...(label.color === undefined ? {} : { color: label.color }),
  id: label.id,
  name: label.name,
  type: label.type,
});

export const listGmailLabelCatalog = Effect.fn("listGmailLabelCatalog")(
  function* listGmailLabelCatalog(request: GmailLabelCatalogRequest) {
    const labels = yield* runGmail(
      Gmail.pipe(
        Effect.flatMap((gmail) =>
          gmail.listLabels({ accountId: AccountId.make(request.accountId) })
        )
      )
    );

    return {
      labels: labels.map(toGmailLabelSummary),
    } satisfies GmailLabelCatalog;
  }
);

export const syncGmailLabelCatalog = Effect.fn("syncGmailLabelCatalog")(
  function* syncGmailLabelCatalog(request: GmailLabelCatalogRequest) {
    const labels = yield* runGmail(
      Gmail.pipe(
        Effect.flatMap((gmail) =>
          gmail.listLabels({
            accountId: AccountId.make(request.accountId),
            refresh: true,
          })
        )
      )
    );

    return {
      labels: labels.map(toGmailLabelSummary),
      syncedAt: Date.now(),
    } satisfies GmailLabelCatalog;
  }
);

const isPresentId = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined;

interface RawThreadMessage {
  readonly id?: string | null;
  readonly payload?: { readonly headers?: readonly MessageHeader[] };
}

const loadNotificationSenderBrand = Effect.fn("loadNotificationSenderBrand")(
  function* loadNotificationSenderBrand(message: NewMailNotificationMessage) {
    const hasCachedBrand = yield* hasCachedSenderBrand(message.fromAddress);

    if (!hasCachedBrand) {
      return null;
    }

    // Only known brand domains pay for this re-read. The current message's own
    // authentication headers still have to validate the cached BIMI logo.
    const rawMessages = yield* runGmail(
      Effect.gen(function* loadRawNotificationMessage() {
        const store = yield* GmailStore;
        const gateway = yield* GmailGateway;
        const authorization = yield* store.getAuthorization(
          AccountId.make(message.accountId)
        );

        if (authorization._tag === "None") {
          return [];
        }

        const result = yield* gateway.getThread(
          authorization.value,
          ThreadId.make(message.threadId)
        );

        return result.value.messages as readonly RawThreadMessage[];
      })
    );
    const rawMessage = rawMessages.find(({ id }) => id === message.messageId);

    if (rawMessage === undefined) {
      return null;
    }

    return yield* getSenderBrand({
      from: message.fromAddress,
      headers: rawMessage.payload?.headers ?? [],
    });
  }
);

const formatList = (
  mailboxes: readonly { readonly address: string }[]
): string => mailboxes.map((mailbox) => mailbox.address).join(", ");

const toThreadMessage = (
  message: GmailDomainThread["messages"][number],
  senderBrand: GmailSenderBrand | null
): GmailThreadMessage => {
  const bcc = formatList(message.bcc);
  const cc = formatList(message.cc);
  const to = formatList(message.to);

  return {
    attachments: message.attachments.map((attachment) => ({
      attachmentId: attachment.attachmentId,
      filename: attachment.filename,
      mediaType: attachment.mediaType,
      messageId: attachment.messageId,
      size: attachment.size,
    })),
    body:
      message.body.type === "html"
        ? { html: message.body.sanitizedHtml }
        : { text: message.body.text },
    from: message.from.address,
    id: message.id,
    labelIds: [...message.labelIds],
    sentAt: Number(message.sentAt),
    snippet: "",
    subject: message.subject.length === 0 ? "(No subject)" : message.subject,
    ...(bcc.length === 0 ? {} : { bcc }),
    ...(cc.length === 0 ? {} : { cc }),
    ...(message.replyTo === undefined
      ? {}
      : { replyTo: message.replyTo.address }),
    ...(senderBrand === null ? {} : { senderBrand }),
    ...(to.length === 0 ? {} : { to }),
  };
};

/**
 * Replaces the `cid:` urls in each body with the bytes they name. An image that
 * cannot be fetched keeps its dead url rather than failing the whole thread.
 */
const withInlineImages = Effect.fn("withInlineImages")(
  function* withInlineImages(
    accountId: AccountId,
    parsedMessages: GmailDomainThread["messages"],
    messages: readonly GmailThreadMessage[]
  ) {
    const attachmentsById = new Map<
      string,
      GmailDomainThread["messages"][number]["attachments"]
    >(parsedMessages.map((message) => [message.id, message.attachments]));
    const wanted = messages.flatMap((message) =>
      message.body.html === undefined
        ? []
        : selectInlineImages(
            message.body.html,
            attachmentsById.get(message.id) ?? []
          ).map((attachment) => ({ attachment, messageId: message.id }))
    );

    if (wanted.length === 0) {
      return messages;
    }

    const loaded = yield* runGmail(
      Gmail.pipe(
        Effect.flatMap((gmail) =>
          Effect.forEach(
            wanted,
            ({ attachment, messageId }) =>
              gmail
                .getAttachment({
                  accountId,
                  attachmentId: attachment.attachmentId,
                  filename: attachment.filename,
                  mediaType: attachment.mediaType,
                  messageId: attachment.messageId,
                })
                .pipe(
                  Effect.map((image) => ({
                    contentId: attachment.contentId,
                    dataUrl: toImageDataUrl(image.mediaType, image.bytes),
                    messageId,
                  })),
                  Effect.orElseSucceed(() => null)
                ),
            { concurrency: INLINE_IMAGE_CONCURRENCY }
          )
        )
      )
    );
    const dataUrlsByMessage = new Map<string, Map<string, string>>();

    for (const image of loaded) {
      if (image === null || image.dataUrl === undefined) {
        continue;
      }

      const dataUrls =
        dataUrlsByMessage.get(image.messageId) ?? new Map<string, string>();

      dataUrls.set(normalizeContentId(image.contentId), image.dataUrl);
      dataUrlsByMessage.set(image.messageId, dataUrls);
    }

    return messages.map((message) => {
      const dataUrls = dataUrlsByMessage.get(message.id);

      return dataUrls === undefined || message.body.html === undefined
        ? message
        : {
            ...message,
            body: {
              ...message.body,
              html: inlineImageDataUrls(message.body.html, dataUrls),
            },
          };
    });
  }
);

const resolveLabelNames = (accountId: string, labelIds: readonly string[]) =>
  withDatabase("Could not load Gmail labels", async (database) => {
    const rows = await database.query.gmailLabels.findMany({
      where: { accountEmail: accountId },
    });
    const namesById = new Map(
      rows.map((row) => [row.labelId, row.name] as const)
    );

    return labelIds.map((labelId) => namesById.get(labelId) ?? labelId);
  });

const fetchFullThreadFromGmail = Effect.fn("fetchFullThreadFromGmail")(
  function* fetchFullThreadFromGmail(request: GmailThreadRequest) {
    const accountId = AccountId.make(request.accountId);
    const threadId = ThreadId.make(request.threadId);
    // The raw thread is needed twice: parsed into the domain model, and kept
    // for the headers BIMI discovery reads.
    const loaded = yield* runGmail(
      Effect.gen(function* loadRawThread() {
        const store = yield* GmailStore;
        const gateway = yield* GmailGateway;
        const mime = yield* GmailMime;
        const authorization = yield* store.getAuthorization(accountId);

        if (authorization._tag === "None") {
          return;
        }

        const result = yield* gateway.getThread(authorization.value, threadId);
        const parsed = yield* mime.parseThread(result.value);
        yield* store.saveThread(accountId, parsed);

        return {
          parsed,
          raw: result.value.messages as readonly RawThreadMessage[],
        };
      })
    );

    if (loaded === undefined) {
      return yield* new MailSyncError({
        message: `Gmail account ${request.accountId} is not connected`,
      });
    }

    const { parsed, raw } = loaded;

    const headersById = new Map(
      raw.flatMap((message) =>
        isPresentId(message.id)
          ? [[message.id, message.payload?.headers ?? []] as const]
          : []
      )
    );
    const messages = yield* Effect.forEach(
      parsed.messages,
      (message) =>
        getSenderBrand({
          from: message.from.address,
          headers: headersById.get(message.id) ?? [],
        }).pipe(
          Effect.orElseSucceed(() => null),
          Effect.map((senderBrand) => toThreadMessage(message, senderBrand))
        ),
      { concurrency: 3 }
    ).pipe(
      Effect.map((built) =>
        built.toSorted((left, right) => left.sentAt - right.sentAt)
      ),
      Effect.flatMap((built) =>
        withInlineImages(accountId, parsed.messages, built)
      )
    );

    // Opening a thread marks it read, mirroring Gmail's own behaviour.
    const wasUnread = parsed.messages.some((message) =>
      message.labelIds.includes(LabelId.make("UNREAD"))
    );

    if (wasUnread) {
      yield* runGmail(
        Gmail.pipe(
          Effect.flatMap((gmail) =>
            gmail.markThreadRead({ accountId, threadId })
          )
        )
      ).pipe(
        Effect.tap(() =>
          Effect.sync(() =>
            dismissThreadNotifications(request.accountId, request.threadId)
          )
        ),
        Effect.catch((error) =>
          Effect.logWarning(
            `Could not mark Gmail thread as read: ${error.message}`
          )
        )
      );

      yield* reloadThreadList(request.accountId);
    }

    return {
      accountId: request.accountId,
      labels: yield* resolveLabelNames(request.accountId, [...parsed.labelIds]),
      messages: wasUnread
        ? messages.map((message) => ({
            ...message,
            labelIds: removeUnreadLabel(message.labelIds),
          }))
        : messages,
      subject: messages[0]?.subject ?? "(No subject)",
      threadId: parsed.id,
    } satisfies GmailThreadDto;
  }
);

const activeThreadRefreshes = new Set<string>();

const requestThreadRefresh = (request: GmailThreadRequest): void => {
  const key = `${request.accountId}:${request.threadId}`;

  if (activeThreadRefreshes.has(key)) {
    return;
  }

  activeThreadRefreshes.add(key);

  const refresh = async (): Promise<void> => {
    try {
      const thread = await Effect.runPromise(fetchFullThreadFromGmail(request));

      sendRendererEvent(
        MAIL_THREAD_UPDATED_CHANNEL,
        GmailThreadUpdated,
        thread
      );
    } catch (error) {
      await Effect.runPromise(
        Effect.logWarning(
          "Could not refresh Gmail thread in the background",
          error
        )
      );
    } finally {
      activeThreadRefreshes.delete(key);
    }
  };

  void refresh();
};

const activeReadMutations = new Set<string>();

const toReadStateSummary = (
  summary: GmailThreadSummary,
  isUnread: boolean
): GmailThreadSummary => ({
  ...summary,
  isUnread,
  labels: isUnread
    ? addUnreadLabel(summary.labels)
    : removeUnreadLabel(summary.labels),
});

const markCachedThreadRead = Effect.fn("markCachedThreadRead")(
  function* markCachedThreadRead(request: GmailThreadRequest) {
    yield* runGmail(
      Gmail.pipe(
        Effect.flatMap((gmail) =>
          gmail.markThreadRead({
            accountId: AccountId.make(request.accountId),
            threadId: ThreadId.make(request.threadId),
          })
        )
      )
    );
    yield* Effect.sync(() =>
      dismissThreadNotifications(request.accountId, request.threadId)
    );
    const summary = yield* withDatabase(
      "Could not cache email",
      async (database) => {
        const row = await database.query.gmailThreads.findFirst({
          where: {
            accountEmail: request.accountId,
            threadId: request.threadId,
          },
        });

        if (row === undefined) {
          return;
        }

        const updated = toReadStateSummary(toCachedThreadSummary(row), false);

        await database
          .update(gmailThreads)
          .set({
            isUnread: updated.isUnread,
            labels: updated.labels,
            updatedAt: Date.now(),
          })
          .where(
            andSql(
              eq(gmailThreads.accountEmail, request.accountId),
              eq(gmailThreads.threadId, request.threadId)
            )
          )
          .run();

        return updated;
      }
    );

    yield* summary === undefined
      ? reloadThreadList(request.accountId)
      : publishThreadListUpdated([{ kind: "upsert", thread: summary }]);
  }
);

const requestCachedThreadRead = (request: GmailThreadRequest): void => {
  const key = `${request.accountId}:${request.threadId}`;

  if (activeReadMutations.has(key)) {
    return;
  }

  activeReadMutations.add(key);

  const markRead = async (): Promise<void> => {
    try {
      await Effect.runPromise(markCachedThreadRead(request));
    } catch (error) {
      await Effect.runPromise(
        Effect.logWarning("Could not mark cached Gmail thread as read", error)
      );
    } finally {
      activeReadMutations.delete(key);
    }
  };

  void markRead();
};

export const loadFullThread = Effect.fn("loadFullThread")(
  function* loadFullThread(request: GmailThreadRequest) {
    const cached = yield* readCachedConversation(request);

    if (cached === undefined) {
      return yield* fetchFullThreadFromGmail(request);
    }

    const now = yield* Clock.currentTimeMillis;

    if (getThreadCacheState(cached.cachedAt, now) === "stale") {
      yield* Effect.sync(() => requestThreadRefresh(request));
    } else if (cached.isUnread) {
      yield* Effect.sync(() => requestCachedThreadRead(request));
    }

    return cached.thread;
  }
);

const findCachedThread = (accountId: string, threadId: string) =>
  withDatabase("Could not load email", (database) =>
    database.query.gmailThreads.findFirst({
      where: { accountEmail: accountId, threadId },
    })
  );

const toCachedThreadListChanges = Effect.fn("toCachedThreadListChanges")(
  function* toCachedThreadListChanges(
    accountId: string,
    threadIds: readonly ThreadId[]
  ) {
    if (threadIds.length === 0) {
      return [];
    }

    const rows = yield* withDatabase("Could not load email", (database) =>
      database
        .select()
        .from(gmailThreads)
        .where(
          andSql(
            eq(gmailThreads.accountEmail, accountId),
            inArraySql(gmailThreads.threadId, [...threadIds])
          )
        )
        .all()
    );
    const rowsById = new Map(rows.map((row) => [row.threadId, row]));

    return threadIds.map((threadId): GmailThreadListChange => {
      const row = rowsById.get(threadId);

      return row === undefined
        ? { accountId, kind: "remove", threadId }
        : { kind: "upsert", thread: toCachedThreadSummary(row) };
    });
  }
);

const publishCachedThreadListChanges = Effect.fn(
  "publishCachedThreadListChanges"
)(function* publishCachedThreadListChanges(
  accountId: string,
  threadIds: readonly ThreadId[]
) {
  const changes = yield* toCachedThreadListChanges(accountId, threadIds);

  if (changes.length > 0) {
    yield* publishThreadListUpdated(changes);
  }
});

const updateCachedThread = (
  summary: GmailThreadSummary
): Effect.Effect<void, MailSyncError> =>
  withDatabase("Could not cache email", async (database) => {
    await database
      .update(gmailThreads)
      .set({
        // `is_in_inbox` is derived from the labels, so the two always move
        // together — the paging query reads the column, not the JSON.
        isInInbox: summary.labels.includes(GMAIL_INBOX_LABEL),
        isUnread: summary.isUnread,
        labels: summary.labels,
        updatedAt: Date.now(),
      })
      .where(eq(gmailThreads.threadId, summary.threadId))
      .run();
  });

// Trashing is a label move for Gmail, so the cached row mirrors it rather than
// being deleted: losing INBOX is already how the cache hides an archived
// thread, and the next sync reconciles the row either way.
const toTrashedSummary = (summary: GmailThreadSummary): GmailThreadSummary => ({
  ...summary,
  labels: [
    ...summary.labels.filter(
      (label) => label !== GMAIL_INBOX_LABEL && label !== GMAIL_TRASH_LABEL
    ),
    GMAIL_TRASH_LABEL,
  ],
});

export const setThreadReadState = Effect.fn("setThreadReadState")(
  function* setThreadReadState(request: GmailThreadReadStateRequest) {
    const mutation = {
      accountId: AccountId.make(request.accountId),
      threadId: ThreadId.make(request.threadId),
    };

    yield* runGmail(
      Gmail.pipe(
        Effect.flatMap((gmail) =>
          request.isUnread
            ? gmail.markThreadUnread(mutation)
            : gmail.markThreadRead(mutation)
        )
      )
    );

    if (!request.isUnread) {
      yield* Effect.sync(() =>
        dismissThreadNotifications(request.accountId, request.threadId)
      );
    }

    const row = yield* findCachedThread(request.accountId, request.threadId);

    if (row === undefined) {
      yield* reloadThreadList(request.accountId);
      return;
    }

    const summary = toReadStateSummary(
      toCachedThreadSummary(row),
      request.isUnread
    );

    yield* updateCachedThread(summary);
    yield* publishThreadListUpdated([{ kind: "upsert", thread: summary }]);
  }
);

const parseRecipients = Effect.fn("parseRecipients")(function* parseRecipients(
  addresses: readonly string[]
) {
  const recipients: Mailbox[] = [];

  for (const address of addresses) {
    const mailbox = parseMailbox(address);

    if (mailbox === undefined) {
      return yield* new MailSyncError({
        message: `Invalid recipient address: ${address}`,
      });
    }

    recipients.push(mailbox);
  }

  return recipients;
});

const refreshAccountAfterSend = Effect.fn("refreshAccountAfterSend")(
  function* refreshAccountAfterSend(accountId: string) {
    const result = yield* runGmail(
      Gmail.pipe(
        Effect.flatMap((gmail) =>
          gmail.sync({
            accountId: AccountId.make(accountId),
            reason: "after-send",
          })
        )
      )
    );
    yield* publishCachedThreadListChanges(accountId, result.changedThreadIds);
  }
);

const refreshAfterSend = Effect.fn("refreshAfterSend")(
  function* refreshAfterSend(request: GmailThreadMessageSendRequest) {
    yield* refreshAccountAfterSend(request.accountId);

    if (request.action !== "forward") {
      const thread = yield* fetchFullThreadFromGmail({
        accountId: request.accountId,
        threadId: request.threadId,
      });

      yield* Effect.sync(() =>
        sendRendererEvent(
          MAIL_THREAD_UPDATED_CHANNEL,
          GmailThreadUpdated,
          thread
        )
      );
    }
  },
  // Oxlint mistakes Effect's combinator for Promise.prototype.catch.
  // oxlint-disable-next-line promise/prefer-await-to-callbacks promise/prefer-await-to-then
  Effect.catch((error) =>
    Effect.logWarning(
      `Message sent, but Gmail refresh failed: ${error.message}`
    )
  )
);

const refreshAfterNewMessage = Effect.fn("refreshAfterNewMessage")(
  function* refreshAfterNewMessage(accountId: string) {
    yield* refreshAccountAfterSend(accountId);
  },
  // Oxlint mistakes Effect's combinator for Promise.prototype.catch.
  // oxlint-disable-next-line promise/prefer-await-to-callbacks promise/prefer-await-to-then
  Effect.catch((error) =>
    Effect.logWarning(
      `Message sent, but Gmail refresh failed: ${error.message}`
    )
  )
);

export const sendNewMessage = Effect.fn("sendNewMessage")(
  function* sendNewMessage(request: GmailMessageSendRequest) {
    const [to, cc, bcc] = yield* Effect.all([
      parseRecipients(request.to),
      parseRecipients(request.cc),
      parseRecipients(request.bcc),
    ]);
    const recipientCount = to.length + cc.length + bcc.length;

    if (recipientCount === 0) {
      return yield* new MailSyncError({
        message: "Add at least one recipient before sending",
      });
    }

    const attachmentStats = yield* Effect.forEach(
      request.attachments,
      (attachment) =>
        Effect.tryPromise({
          catch: () =>
            new MailSyncError({
              message: `Could not read attachment: ${attachment.filename}`,
            }),
          try: () => stat(attachment.path),
        }),
      { concurrency: 3 }
    );
    const invalidAttachmentIndex = attachmentStats.findIndex(
      (attachmentStat) => !attachmentStat.isFile()
    );

    if (invalidAttachmentIndex !== -1) {
      return yield* new MailSyncError({
        message: `Could not read attachment: ${request.attachments[invalidAttachmentIndex]?.filename ?? "Unknown file"}`,
      });
    }

    const attachmentBytes = attachmentStats.reduce(
      (total, attachmentStat) => total + attachmentStat.size,
      0
    );

    if (attachmentBytes > MAX_GMAIL_ATTACHMENT_BYTES) {
      return yield* new MailSyncError({
        message: "Attachments can total up to 25 MB",
      });
    }

    const attachments = yield* Effect.forEach(
      request.attachments,
      (attachment) =>
        Effect.tryPromise({
          catch: () =>
            new MailSyncError({
              message: `Could not read attachment: ${attachment.filename}`,
            }),
          try: async () => ({
            bytes: await readFile(attachment.path),
            filename: attachment.filename,
            mediaType: attachment.mediaType,
          }),
        }),
      { concurrency: 1 }
    );
    const loadedAttachmentBytes = attachments.reduce(
      (total, attachment) => total + attachment.bytes.byteLength,
      0
    );

    if (loadedAttachmentBytes > MAX_GMAIL_ATTACHMENT_BYTES) {
      return yield* new MailSyncError({
        message: "Attachments can total up to 25 MB",
      });
    }

    yield* runGmail(
      Gmail.pipe(
        Effect.flatMap((gmail) =>
          gmail.sendMessage({
            accountId: AccountId.make(request.accountId),
            attachments,
            bcc,
            body: {
              html: request.body.html,
              text: request.body.text,
              type: "html",
            },
            cc,
            subject: request.subject,
            to,
          })
        )
      )
    );

    yield* refreshAfterNewMessage(request.accountId);
  }
);

export const sendThreadMessage = Effect.fn("sendThreadMessage")(
  function* sendThreadMessage(request: GmailThreadMessageSendRequest) {
    const [to, cc, bcc] = yield* Effect.all([
      parseRecipients(request.to),
      parseRecipients(request.cc),
      parseRecipients(request.bcc),
    ]);
    const recipientCount = to.length + cc.length + bcc.length;

    if (recipientCount === 0) {
      return yield* new MailSyncError({
        message: "Add at least one recipient before sending",
      });
    }

    const input = {
      accountId: AccountId.make(request.accountId),
      bcc,
      body: {
        html: request.body.html,
        text: request.body.text,
        type: "html" as const,
      },
      cc,
      threadId: ThreadId.make(request.threadId),
      to,
    };

    yield* runGmail(
      Gmail.pipe(
        Effect.flatMap((gmail) =>
          request.action === "forward"
            ? gmail.forward({
                ...input,
                forwardMessageId: MessageId.make(request.messageId),
              })
            : gmail.reply({
                ...input,
                replyToMessageId: MessageId.make(request.messageId),
              })
        )
      )
    );

    yield* refreshAfterSend(request);
  }
);

export const trashThread = Effect.fn("trashThread")(function* trashThread(
  request: GmailThreadRequest
) {
  const row = yield* findCachedThread(request.accountId, request.threadId);

  yield* runGmail(
    Gmail.pipe(
      Effect.flatMap((gmail) =>
        gmail.trashThread({
          accountId: AccountId.make(request.accountId),
          threadId: ThreadId.make(request.threadId),
        })
      )
    )
  );
  yield* Effect.sync(() =>
    dismissThreadNotifications(request.accountId, request.threadId)
  );

  // `Gmail.trashThread` deletes the cached row; re-insert it with TRASH so the
  // list keeps rendering the thread until the next sync reconciles it.
  if (row !== undefined) {
    const summary = toTrashedSummary(toCachedThreadSummary(row));

    yield* withDatabase("Could not cache email", async (database) => {
      // `is_in_inbox` has to be cleared explicitly: the spread carries the old
      // `true` from `row`, and the paging query reads that column, so a trashed
      // thread would otherwise keep its place in the list.
      const values = {
        isInInbox: false,
        labels: summary.labels,
        updatedAt: Date.now(),
      };

      await database
        .insert(gmailThreads)
        .values({ ...row, ...values })
        .onConflictDoUpdate({
          set: values,
          target: [gmailThreads.accountEmail, gmailThreads.threadId],
        })
        .run();
    });

    yield* publishThreadListUpdated([{ kind: "upsert", thread: summary }]);
    return;
  }

  yield* publishThreadListUpdated([
    {
      accountId: request.accountId,
      kind: "remove",
      threadId: request.threadId,
    },
  ]);
});

const activeTrashMutations = new Set<string>();

const requestCachedThreadTrash = (request: GmailThreadRequest): void => {
  const key = `${request.accountId}:${request.threadId}`;

  if (activeTrashMutations.has(key)) {
    return;
  }

  activeTrashMutations.add(key);

  const trash = async (): Promise<void> => {
    try {
      await Effect.runPromise(trashThread(request));
    } catch (error) {
      await Effect.runPromise(
        Effect.logWarning("Could not trash cached Gmail thread", error)
      );
    } finally {
      activeTrashMutations.delete(key);
    }
  };

  void trash();
};

const syncAccount = Effect.fn("syncAccount")(function* syncAccount(
  accountId: string
) {
  const result = yield* runGmail(
    Gmail.pipe(
      Effect.flatMap((gmail) =>
        gmail.sync({ accountId: AccountId.make(accountId), reason: "timer" })
      )
    )
  );

  if (result.changedThreadIds.length > 0) {
    yield* publishCachedThreadListChanges(accountId, result.changedThreadIds);
  }

  if (result.type === "partial" && result.addedMessageIds.length > 0) {
    yield* showNewMailNotifications(
      accountId,
      result.addedMessageIds,
      loadNotificationSenderBrand,
      requestCachedThreadRead,
      requestCachedThreadTrash
    ).pipe(
      Effect.catch((error) =>
        Effect.logWarning(
          `Could not show new email notifications: ${error.message}`
        )
      )
    );
  }
});

const syncAllAccounts = Effect.fn("syncAllAccounts")(
  function* syncAllAccounts() {
    const accounts = yield* withDatabase(
      "Could not load Google accounts",
      (database) =>
        database.query.googleAccounts.findMany({
          columns: { email: true, scopes: true },
        })
    );
    const readableAccounts = accounts.filter(({ scopes }) => {
      const granted = JSON.parse(scopes) as unknown;

      return (
        Array.isArray(granted) &&
        granted.some(
          (scope) => typeof scope === "string" && GMAIL_READ_SCOPES.has(scope)
        )
      );
    });
    const retrySchedule = Schedule.exponential(1000).pipe(Schedule.jittered);

    yield* Effect.forEach(
      readableAccounts,
      ({ email }) =>
        Effect.gen(function* syncAccountWithStatus() {
          yield* Effect.sync(() => setAccountSyncing(email, true));
          yield* syncAccount(email).pipe(
            Effect.retry({
              schedule: retrySchedule,
              times: MAX_SYNC_RETRIES,
              while: (error) => error.retryable === true,
            }),
            Effect.ignore,
            Effect.ensuring(Effect.sync(() => setAccountSyncing(email, false)))
          );
        }),
      { concurrency: 2, discard: true }
    );
  }
);

let hasStartedMailSync = false;
let pollTimer: ReturnType<typeof setTimeout> | undefined;

const pollMail = async (): Promise<void> => {
  await Effect.runPromise(syncAllAccounts().pipe(Effect.ignore));

  if (!hasStartedMailSync) {
    return;
  }

  pollTimer = setTimeout(() => {
    void pollMail();
  }, POLL_INTERVAL_MS);
  pollTimer.unref();
};

export const startMailSync = (): void => {
  if (hasStartedMailSync) {
    return;
  }

  hasStartedMailSync = true;
  void pollMail();
};

export const stopMailSync = (): void => {
  hasStartedMailSync = false;

  if (pollTimer !== undefined) {
    clearTimeout(pollTimer);
    pollTimer = undefined;
  }
};

export const getMailSyncStatus = (): GmailSyncStatus => ({
  accountIds: [...syncingAccountIds],
});
