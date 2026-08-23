import { gunzipSync } from "node:zlib";

import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import {
  gmailMessages,
  gmailSyncState,
  gmailThreads,
} from "@repo/database/schemas";
import { withReconciledThread } from "@repo/gmail/errors";
import type { GmailError } from "@repo/gmail/errors";
import { GmailGateway } from "@repo/gmail/gateway";
import { GmailMime } from "@repo/gmail/mime";
import type {
  GmailLabel,
  GmailThread as GmailDomainThread,
  Mailbox,
} from "@repo/gmail/models";
import {
  AccountId,
  isGmailScope,
  LabelColor,
  LabelId,
  MessageId,
  PageCursor,
  ThreadId,
} from "@repo/gmail/models";
import { Gmail } from "@repo/gmail/service";
import type {
  BatchThreadMutationOutcome,
  ThreadMutationOutcome,
} from "@repo/gmail/service";
import { GmailStore } from "@repo/gmail/store";
import { and as andSql, eq, inArray as inArraySql } from "drizzle-orm";
import { Clock, Effect, Layer, Option, Schedule, Schema } from "effect";

import {
  MAIL_LABEL_CATALOG_CHANGED_CHANNEL,
  MAIL_SYNC_STATUS_CHANNEL,
  MAIL_THREAD_LIST_UPDATED_CHANNEL,
  MAIL_THREAD_UPDATED_CHANNEL,
} from "../../shared/ipc/channels";
import {
  GmailLabelCatalogChanged,
  GmailSyncStatus,
  GmailThreadListUpdated,
  GmailThreadUpdated,
} from "../../shared/ipc/mail";
import type {
  GmailCachedThreadPage,
  GmailCachedThreadPageRequest,
  GmailBulkThreadMutationOperation,
  GmailBulkThreadMutationRequest,
  GmailBulkThreadMutationResult,
  GmailLabelCatalog,
  GmailLabelCatalogRequest,
  GmailLabelCreateRequest,
  GmailLabelDeleteRequest,
  GmailLabelInputColor,
  GmailLabelSummary,
  GmailLabelUpdateRequest,
  GmailMessageSendRequest,
  GmailOutgoingAttachmentCapability,
  GmailSenderBrand,
  GmailSpamStatus,
  GmailSpamStatusRequest,
  GmailThread as GmailThreadDto,
  GmailThreadMessage,
  GmailThreadMessageSendRequest,
  GmailThreadLabelRequest,
  GmailThreadReadStateRequest,
  GmailThreadRequest,
  GmailThreadListChange,
  GmailThreadSummary,
} from "../../shared/ipc/mail";
import { withDatabaseClient } from "../database";
import { sendRendererEvent } from "../electron/renderer-events";
import { accountMailWorkSupervisor } from "./account-mail-work-supervisor";
import { planBulkThreadMutation } from "./bulk-mutation-quota";
import { forgetCachedCorrespondents } from "./correspondent-cache";
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
import { outgoingAttachmentAuthorizations } from "./outgoing-attachment-authorizations";
import { mailQuotaGovernor, QUOTA_UNITS } from "./quota-governor";
import { addUnreadLabel, removeUnreadLabel } from "./read-state";
import type { MessageHeader } from "./sender-brand";
import { getSenderBrand, hasCachedSenderBrand } from "./sender-brand";
import { hasUnreadSpamRemote, resetSpamBackfillRemote } from "./spam-mailbox";
import { getThreadCacheState } from "./thread-cache-policy";
import { publishReconciledGmailError } from "./thread-reconciliation";
import { refreshUnreadBadge } from "./unread-badge";

const GMAIL_INBOX_LABEL = "INBOX";
const GMAIL_DRAFT_LABEL = "DRAFT";
const GMAIL_SPAM_LABEL = "SPAM";
const GMAIL_TRASH_LABEL = "TRASH";
const THREAD_PAGE_SIZE = 50;
const SPAM_PAGE_QUOTA_UNITS =
  QUOTA_UNITS.threadsList + THREAD_PAGE_SIZE * QUOTA_UNITS.threadsGet;
const INLINE_IMAGE_CONCURRENCY = 3;
const POLL_INTERVAL_MS = 15_000;
const MAX_SYNC_RETRIES = 5;
const SQLITE_BULK_ID_CHUNK_SIZE = 400;
const MAX_BULK_THREAD_COUNT = 5000;
// Whole-thread mutations have no typed Gmail bulk endpoint. The official Node
// client multiplexes this bounded burst over HTTP/2.
const BULK_THREAD_FALLBACK_CONCURRENCY = 25;

// oxlint-disable-next-line unicorn/throw-new-error
class MailSyncError extends Schema.TaggedError<MailSyncError>()(
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

const getMailSyncErrorMessage = (error: GmailError): string => {
  if (
    error._tag === "GmailEntityNotFoundError" &&
    error.resource === "thread"
  ) {
    return "This conversation no longer exists in Gmail";
  }

  if (error._tag === "GmailApiError" && error.status === 404) {
    return "Gmail could not find the requested resource";
  }

  return error.message;
};

const toMailSyncError = (error: GmailError): MailSyncError =>
  new MailSyncError({
    message: getMailSyncErrorMessage(error),
    retryable: isRetryableGmailError(error),
  });

/**
 * The layer is rebuilt per call rather than held in a `ManagedRuntime`, so the
 * per-account semaphore inside `GmailService` does not span calls. Request
 * concurrency is already bounded below it (thread fetches at 5 in the gateway)
 * and above it (two accounts at a time in the poll loop).
 */
const runGmail = <A>(
  effect: Effect.Effect<A, GmailError, GmailServices>
): Effect.Effect<A, MailSyncError> =>
  effect.pipe(
    Effect.provide(GmailLive),
    Effect.tapErrorTag("GmailEntityNotFoundError", publishReconciledGmailError),
    Effect.mapError(toMailSyncError)
  );

const loadRawThread = Effect.fn("loadRawThread")(function* loadRawThread(
  accountId: AccountId,
  threadId: ThreadId
) {
  const store = yield* GmailStore;
  const gateway = yield* GmailGateway;
  const authorization = yield* store.getAuthorization(accountId);

  if (Option.isNone(authorization)) {
    return;
  }

  const result = yield* gateway
    .getThread(authorization.value, threadId)
    .pipe(
      Effect.catchTag("GmailEntityNotFoundError", (error) =>
        store
          .removeThreads(accountId, [threadId])
          .pipe(
            Effect.flatMap(() =>
              withReconciledThread(error, { outcome: "removed", threadId })
            )
          )
      )
    );

  return result.value;
});

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
    bcc: bcc.length === 0 ? undefined : bcc,
    body,
    cc: cc.length === 0 ? undefined : cc,
    from: row.fromAddress,
    id: row.messageId,
    labelIds: removeUnreadLabel(row.labelIds ?? []),
    replyTo: row.replyToAddress ?? undefined,
    sentAt: row.internalDate,
    snippet: "",
    subject: row.subject.length === 0 ? "(No subject)" : row.subject,
    to: to.length === 0 ? undefined : to,
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

    const mailbox = request.mailbox ?? "inbox";
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
          OR:
            request.cursor === undefined
              ? undefined
              : [
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
          accountEmail: { in: [...request.accountIds] },
          // The inbox predicate has to be in SQL, not a filter over the
          // page below: the index stores archived mail in this table too,
          // so filtering afterwards would return near-empty pages while
          // paging through everything the user archived.
          isInInbox: mailbox === "spam" ? undefined : true,
          isInSpam: mailbox === "spam" ? true : undefined,
          isUnread: request.unreadOnly === true ? true : undefined,
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

export const getSpamStatus = Effect.fn("getSpamStatus")(function* getSpamStatus(
  request: GmailSpamStatusRequest
) {
  const hasUnreadSpam = yield* withDatabase(
    "Could not check unread spam",
    (database) => hasUnreadSpamRemote(database, request.accountIds)
  );

  return { hasUnreadSpam } satisfies GmailSpamStatus;
});

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

const publishLabelCatalogChanged = Effect.fn("publishLabelCatalogChanged")(
  function* publishLabelCatalogChanged(accountId: string) {
    yield* Effect.sync(() => {
      sendRendererEvent(
        MAIL_LABEL_CATALOG_CHANGED_CHANNEL,
        GmailLabelCatalogChanged,
        { accountId }
      );
    });
  }
);

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
  color: label.color,
  id: label.id,
  name: label.name,
  threadCount: label.threadCount,
  type: label.type,
});

const toLabelColor = (
  color: GmailLabelInputColor | undefined
): LabelColor | undefined =>
  color === undefined ? undefined : new LabelColor(color);

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

export const createGmailLabel = Effect.fn("createGmailLabel")(
  function* createGmailLabel(request: GmailLabelCreateRequest) {
    const label = yield* runGmail(
      Gmail.pipe(
        Effect.flatMap((gmail) =>
          gmail.createLabel({
            accountId: AccountId.make(request.accountId),
            color: toLabelColor(request.color),
            name: request.name,
          })
        )
      )
    );

    yield* publishLabelCatalogChanged(request.accountId);
    return toGmailLabelSummary(label);
  }
);

export const deleteGmailLabel = Effect.fn("deleteGmailLabel")(
  function* deleteGmailLabel(request: GmailLabelDeleteRequest) {
    yield* runGmail(
      Gmail.pipe(
        Effect.flatMap((gmail) =>
          gmail.deleteLabel({
            accountId: AccountId.make(request.accountId),
            labelId: LabelId.make(request.labelId),
          })
        )
      )
    );
    yield* publishLabelCatalogChanged(request.accountId);
    yield* reloadThreadList(request.accountId);
  }
);

export const updateGmailLabel = Effect.fn("updateGmailLabel")(
  function* updateGmailLabel(request: GmailLabelUpdateRequest) {
    const outcome = yield* runGmail(
      Gmail.pipe(
        Effect.flatMap((gmail) =>
          gmail.updateLabel({
            accountId: AccountId.make(request.accountId),
            color: toLabelColor(request.color),
            labelId: LabelId.make(request.labelId),
            name: request.name,
          })
        )
      )
    );

    yield* publishLabelCatalogChanged(request.accountId);
    yield* reloadThreadList(request.accountId);

    if (outcome.type === "removed") {
      return yield* new MailSyncError({
        message: "This label no longer exists in Gmail",
      });
    }

    return toGmailLabelSummary(outcome.label);
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

    yield* publishLabelCatalogChanged(request.accountId);
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
      loadRawThread(
        AccountId.make(message.accountId),
        ThreadId.make(message.threadId)
      ).pipe(
        Effect.map(
          (thread) => (thread?.messages ?? []) as readonly RawThreadMessage[]
        )
      )
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
    bcc: bcc.length === 0 ? undefined : bcc,
    body:
      message.body.type === "html"
        ? { html: message.body.sanitizedHtml }
        : { text: message.body.text },
    cc: cc.length === 0 ? undefined : cc,
    from: message.from.address,
    id: message.id,
    labelIds: [...message.labelIds],
    replyTo: message.replyTo?.address,
    senderBrand: senderBrand ?? undefined,
    sentAt: Number(message.sentAt),
    snippet: "",
    subject: message.subject.length === 0 ? "(No subject)" : message.subject,
    to: to.length === 0 ? undefined : to,
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
    const threadIdsByMessageId = new Map<string, ThreadId>(
      parsedMessages.map((message) => [message.id, message.threadId])
    );
    const wanted = messages.flatMap((message) => {
      const threadId = threadIdsByMessageId.get(message.id);

      return message.body.html === undefined || threadId === undefined
        ? []
        : selectInlineImages(
            message.body.html,
            attachmentsById.get(message.id) ?? []
          ).map((attachment) => ({
            attachment,
            messageId: message.id,
            threadId,
          }));
    });

    if (wanted.length === 0) {
      return messages;
    }

    const loaded = yield* runGmail(
      Gmail.pipe(
        Effect.flatMap((gmail) =>
          Effect.forEach(
            wanted,
            ({ attachment, messageId, threadId }) =>
              gmail
                .getAttachment({
                  accountId,
                  attachmentId: attachment.attachmentId,
                  filename: attachment.filename,
                  mediaType: attachment.mediaType,
                  messageId: attachment.messageId,
                  threadId,
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
      Effect.gen(function* loadRawThreadForDisplay() {
        const store = yield* GmailStore;
        const mime = yield* GmailMime;
        const raw = yield* loadRawThread(accountId, threadId);

        if (raw === undefined) {
          return;
        }

        const parsed = yield* mime.parseThread(raw);
        yield* store.saveThread(accountId, parsed);

        return {
          parsed,
          raw: raw.messages as readonly RawThreadMessage[],
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

    const readOutcome = wasUnread
      ? yield* runGmail(
          Gmail.pipe(
            Effect.flatMap((gmail) =>
              gmail.markThreadRead({ accountId, threadId })
            )
          )
        ).pipe(
          Effect.catch((error) =>
            Effect.logWarning(
              `Could not mark Gmail thread as read: ${error.message}`
            )
          )
        )
      : undefined;

    if (wasUnread) {
      if (readOutcome === "removed" || readOutcome === "updated") {
        yield* Effect.sync(() =>
          dismissThreadNotifications(request.accountId, request.threadId)
        );
      }

      yield* reloadThreadList(request.accountId);
    }

    return {
      accountId: request.accountId,
      labels: yield* resolveLabelNames(request.accountId, [...parsed.labelIds]),
      messages:
        readOutcome === "updated"
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
    const outcome = yield* runGmail(
      Gmail.pipe(
        Effect.flatMap((gmail) =>
          gmail.markThreadRead({
            accountId: AccountId.make(request.accountId),
            threadId: ThreadId.make(request.threadId),
          })
        )
      )
    );
    if (outcome === "removed") {
      yield* Effect.sync(() =>
        dismissThreadNotifications(request.accountId, request.threadId)
      );
      yield* publishThreadListUpdated([
        {
          accountId: request.accountId,
          kind: "remove",
          threadId: request.threadId,
        },
      ]);
      return;
    }

    if (outcome === "refreshed") {
      yield* reloadThreadList(request.accountId);
      return;
    }

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

const publishThreadMutationOutcome = Effect.fn("publishThreadMutationOutcome")(
  function* publishThreadMutationOutcome(
    request: GmailThreadRequest,
    outcome: ThreadMutationOutcome
  ) {
    if (outcome === "removed") {
      yield* publishCachedThreadListChanges(request.accountId, [
        ThreadId.make(request.threadId),
      ]);
      return;
    }

    const row = yield* findCachedThread(request.accountId, request.threadId);

    yield* row === undefined
      ? reloadThreadList(request.accountId)
      : publishThreadListUpdated([
          { kind: "upsert", thread: toCachedThreadSummary(row) },
        ]);
  }
);

// Trashing is a label move for Gmail, so the cached row mirrors it rather than
// being deleted: losing INBOX is already how the cache hides an archived
// thread, and the next sync reconciles the row either way.
const toTrashedSummary = (summary: GmailThreadSummary): GmailThreadSummary => ({
  ...summary,
  labels: [
    ...summary.labels.filter(
      (label) =>
        label !== GMAIL_INBOX_LABEL &&
        label !== GMAIL_SPAM_LABEL &&
        label !== GMAIL_TRASH_LABEL
    ),
    GMAIL_TRASH_LABEL,
  ],
});

interface ResolvedBulkThread {
  readonly messageIds?: readonly string[];
  readonly request: GmailThreadRequest;
  readonly row?: CachedThreadRow;
}

const getThreadRequestKey = (request: GmailThreadRequest): string =>
  `${request.accountId}\u0000${request.threadId}`;

const chunk = <A>(items: readonly A[], size: number): readonly A[][] => {
  const chunks: A[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const resolveBulkThreads = Effect.fn("resolveBulkThreads")(
  function* resolveBulkThreads(requests: readonly GmailThreadRequest[]) {
    return yield* withDatabase(
      "Could not load selected emails",
      async (database): Promise<readonly ResolvedBulkThread[]> => {
        const byAccount = new Map<string, GmailThreadRequest[]>();

        for (const request of requests) {
          const accountRequests = byAccount.get(request.accountId) ?? [];
          accountRequests.push(request);
          byAccount.set(request.accountId, accountRequests);
        }

        const rowsByKey = new Map<string, CachedThreadRow>();
        const messageIdsByKey = new Map<string, string[]>();
        const draftThreadKeys = new Set<string>();

        for (const [accountId, accountRequests] of byAccount) {
          for (const requestChunk of chunk(
            accountRequests,
            SQLITE_BULK_ID_CHUNK_SIZE
          )) {
            const threadIds = requestChunk.map(({ threadId }) => threadId);
            // oxlint-disable-next-line eslint/no-await-in-loop
            const threadRows = await database
              .select()
              .from(gmailThreads)
              .where(
                andSql(
                  eq(gmailThreads.accountEmail, accountId),
                  inArraySql(gmailThreads.threadId, threadIds)
                )
              )
              .all();
            // oxlint-disable-next-line eslint/no-await-in-loop
            const messageRows = await database
              .select({
                labelIds: gmailMessages.labelIds,
                messageId: gmailMessages.messageId,
                threadId: gmailMessages.threadId,
              })
              .from(gmailMessages)
              .where(
                andSql(
                  eq(gmailMessages.accountEmail, accountId),
                  inArraySql(gmailMessages.threadId, threadIds)
                )
              )
              .all();

            for (const row of threadRows) {
              rowsByKey.set(
                getThreadRequestKey({
                  accountId: row.accountEmail,
                  threadId: row.threadId,
                }),
                row
              );
            }

            for (const row of messageRows) {
              const key = getThreadRequestKey({
                accountId,
                threadId: row.threadId,
              });
              const messageIds = messageIdsByKey.get(key) ?? [];
              messageIds.push(row.messageId);
              messageIdsByKey.set(key, messageIds);

              if (row.labelIds?.includes(GMAIL_DRAFT_LABEL) === true) {
                draftThreadKeys.add(key);
              }
            }
          }
        }

        return requests.map((request) => {
          const key = getThreadRequestKey(request);
          const row = rowsByKey.get(key);
          const messageIds = messageIdsByKey.get(key) ?? [];
          const hasCompleteMessageMembership =
            row !== undefined &&
            messageIds.length > 0 &&
            messageIds.length === row.messageCount &&
            !draftThreadKeys.has(key);

          return {
            messageIds: hasCompleteMessageMembership ? messageIds : undefined,
            request,
            row,
          };
        });
      }
    );
  }
);

const attemptBulkMutation = <A>(
  effect: Effect.Effect<A, MailSyncError>
): Effect.Effect<boolean> =>
  effect.pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false)
  );

const runBatchMutation = Effect.fn("runBatchMutation")(
  function* runBatchMutation(
    operation: GmailBulkThreadMutationOperation,
    accountId: string,
    threads: readonly ResolvedBulkThread[]
  ) {
    const mutation = {
      accountId: AccountId.make(accountId),
      targets: threads.map((thread) => ({
        messageIds: (thread.messageIds ?? []).map((messageId) =>
          MessageId.make(messageId)
        ),
        threadId: ThreadId.make(thread.request.threadId),
      })),
    };

    return yield* runGmail(
      Gmail.pipe(
        Effect.flatMap((gmail) => {
          if (operation.kind === "deleteSpam") {
            return Effect.succeed({ type: "updated" } as const);
          }

          if (operation.kind === "setLabel") {
            return gmail.batchSetThreadLabel({
              ...mutation,
              applied: operation.applied,
              labelId: LabelId.make(operation.labelId),
            });
          }

          if (operation.kind === "setReadState") {
            return gmail.batchSetThreadReadState(mutation, !operation.isUnread);
          }

          return gmail.batchTrashThreads(mutation);
        })
      )
    );
  }
);

const restoreTrashedThreadRows = (
  rows: readonly CachedThreadRow[]
): Effect.Effect<void, MailSyncError> =>
  withDatabase("Could not cache selected emails", async (database) => {
    if (rows.length === 0) {
      return;
    }

    await database.transaction(async (transaction) => {
      for (const row of rows) {
        const summary = toTrashedSummary(toCachedThreadSummary(row));
        // Mailbox paging reads these denormalized flags, not the labels JSON.
        const values = {
          isInInbox: false,
          isInSpam: false,
          labels: summary.labels,
          spamAddedAt: null,
          updatedAt: Date.now(),
        };

        // oxlint-disable-next-line eslint/no-await-in-loop
        await transaction
          .insert(gmailThreads)
          .values({ ...row, ...values })
          .onConflictDoUpdate({
            set: values,
            target: [gmailThreads.accountEmail, gmailThreads.threadId],
          })
          .run();
      }
    });
  });

export const setThreadReadState = Effect.fn("setThreadReadState")(
  function* setThreadReadState(request: GmailThreadReadStateRequest) {
    const mutation = {
      accountId: AccountId.make(request.accountId),
      threadId: ThreadId.make(request.threadId),
    };

    const outcome = yield* runGmail(
      Gmail.pipe(
        Effect.flatMap((gmail) =>
          request.isUnread
            ? gmail.markThreadUnread(mutation)
            : gmail.markThreadRead(mutation)
        )
      )
    );

    if (outcome === "removed" || (outcome === "updated" && !request.isUnread)) {
      yield* Effect.sync(() =>
        dismissThreadNotifications(request.accountId, request.threadId)
      );
    }

    yield* publishThreadMutationOutcome(request, outcome);
  }
);

export const setThreadLabel = Effect.fn("setThreadLabel")(
  function* setThreadLabel(request: GmailThreadLabelRequest) {
    const outcome = yield* runGmail(
      Gmail.pipe(
        Effect.flatMap((gmail) =>
          gmail.setThreadLabel({
            accountId: AccountId.make(request.accountId),
            applied: request.applied,
            labelId: LabelId.make(request.labelId),
            threadId: ThreadId.make(request.threadId),
          })
        )
      )
    );

    yield* publishThreadMutationOutcome(request, outcome);
  }
);

const moveThreadToInbox = Effect.fn("moveThreadToInbox")(
  function* moveThreadToInbox(request: GmailThreadRequest) {
    const outcome = yield* runGmail(
      Gmail.pipe(
        Effect.flatMap((gmail) =>
          gmail.moveThreadToInbox({
            accountId: AccountId.make(request.accountId),
            threadId: ThreadId.make(request.threadId),
          })
        )
      )
    );

    yield* publishThreadMutationOutcome(request, outcome);
  }
);

export const markThreadNotSpam = moveThreadToInbox;

const moveThreadToSpam = Effect.fn("moveThreadToSpam")(
  function* moveThreadToSpam(request: GmailThreadRequest) {
    const outcome = yield* runGmail(
      Gmail.pipe(
        Effect.flatMap((gmail) =>
          gmail.moveThreadToSpam({
            accountId: AccountId.make(request.accountId),
            threadId: ThreadId.make(request.threadId),
          })
        )
      )
    );

    yield* Effect.sync(() =>
      dismissThreadNotifications(request.accountId, request.threadId)
    );
    yield* publishThreadMutationOutcome(request, outcome);
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

const consumeOutgoingAttachments = Effect.fn("consumeOutgoingAttachments")(
  function* consumeOutgoingAttachments(
    ownerWebContentsId: number,
    capabilities: readonly GmailOutgoingAttachmentCapability[]
  ) {
    return yield* Effect.tryPromise({
      catch: (error) =>
        new MailSyncError({
          message:
            error instanceof Error
              ? error.message
              : "Could not read attachments",
        }),
      try: () =>
        outgoingAttachmentAuthorizations.consume(
          ownerWebContentsId,
          capabilities.map(({ capability }) => capability)
        ),
    });
  }
);

export const sendNewMessage = Effect.fn("sendNewMessage")(
  function* sendNewMessage(
    request: GmailMessageSendRequest,
    ownerWebContentsId: number
  ) {
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

    const attachments = yield* consumeOutgoingAttachments(
      ownerWebContentsId,
      request.attachments
    );

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
  function* sendThreadMessage(
    request: GmailThreadMessageSendRequest,
    ownerWebContentsId: number
  ) {
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

    const attachments = yield* consumeOutgoingAttachments(
      ownerWebContentsId,
      request.attachments
    );

    const input = {
      accountId: AccountId.make(request.accountId),
      attachments,
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

  const outcome = yield* runGmail(
    Gmail.pipe(
      Effect.flatMap((gmail) =>
        gmail.trashThread({
          accountId: AccountId.make(request.accountId),
          threadId: ThreadId.make(request.threadId),
        })
      )
    )
  );
  if (outcome !== "updated") {
    if (outcome === "removed") {
      yield* Effect.sync(() =>
        dismissThreadNotifications(request.accountId, request.threadId)
      );
    }
    yield* publishThreadMutationOutcome(request, outcome);
    return;
  }

  yield* Effect.sync(() =>
    dismissThreadNotifications(request.accountId, request.threadId)
  );

  yield* restoreTrashedThreadRows(row === undefined ? [] : [row]);
  yield* publishCachedThreadListChanges(request.accountId, [
    ThreadId.make(request.threadId),
  ]);
});

export const deleteSpamThread = Effect.fn("deleteSpamThread")(
  function* deleteSpamThread(request: GmailThreadRequest) {
    const row = yield* findCachedThread(request.accountId, request.threadId);

    if (row?.isInSpam !== true) {
      return yield* new MailSyncError({
        message: "Only conversations in Spam can be permanently deleted",
      });
    }

    const outcome = yield* runGmail(
      Gmail.pipe(
        Effect.flatMap((gmail) =>
          gmail.deleteThread({
            accountId: AccountId.make(request.accountId),
            threadId: ThreadId.make(request.threadId),
          })
        )
      )
    );
    if (outcome !== "refreshed") {
      yield* Effect.sync(() =>
        dismissThreadNotifications(request.accountId, request.threadId)
      );
    }
    yield* publishThreadMutationOutcome(request, outcome);
  }
);

const runSingleBulkMutation = (
  operation: GmailBulkThreadMutationOperation,
  request: GmailThreadRequest
): Effect.Effect<void, MailSyncError> => {
  if (operation.kind === "deleteSpam") {
    return deleteSpamThread(request);
  }

  if (operation.kind === "setLabel") {
    return setThreadLabel({
      ...request,
      applied: operation.applied,
      labelId: operation.labelId,
    });
  }

  if (operation.kind === "setReadState") {
    return setThreadReadState({ ...request, isUnread: operation.isUnread });
  }

  if (operation.kind === "moveToSpam") {
    return moveThreadToSpam(request);
  }

  if (operation.kind === "moveToInbox") {
    return moveThreadToInbox(request);
  }

  return trashThread(request);
};

const applySuccessfulBatchEffects = Effect.fn("applySuccessfulBatchEffects")(
  function* applySuccessfulBatchEffects(
    operation: GmailBulkThreadMutationOperation,
    accountId: string,
    threads: readonly ResolvedBulkThread[]
  ) {
    if (operation.kind === "setReadState" && !operation.isUnread) {
      yield* Effect.sync(() => {
        for (const thread of threads) {
          dismissThreadNotifications(accountId, thread.request.threadId);
        }
      });
    }

    if (operation.kind === "trash") {
      yield* restoreTrashedThreadRows(
        threads.flatMap((thread) =>
          thread.row === undefined ? [] : [thread.row]
        )
      );
      yield* Effect.sync(() => {
        for (const thread of threads) {
          dismissThreadNotifications(accountId, thread.request.threadId);
        }
      });
    }
  }
);

const applySuccessfulBatch = Effect.fn("applySuccessfulBatch")(
  function* applySuccessfulBatch(
    operation: GmailBulkThreadMutationOperation,
    accountId: string,
    threads: readonly ResolvedBulkThread[]
  ) {
    yield* applySuccessfulBatchEffects(operation, accountId, threads);

    yield* publishCachedThreadListChanges(
      accountId,
      threads.map((thread) => ThreadId.make(thread.request.threadId))
    );
  }
);

const applyReconciledBatch = Effect.fn("applyReconciledBatch")(
  function* applyReconciledBatch(
    operation: GmailBulkThreadMutationOperation,
    accountId: string,
    threads: readonly ResolvedBulkThread[],
    outcome: Extract<
      BatchThreadMutationOutcome,
      { readonly type: "reconciled" }
    >
  ) {
    const outcomesByThreadId = new Map(
      outcome.results.map((result) => [result.threadId, result.outcome])
    );
    const updated = threads.filter(
      (thread) =>
        outcomesByThreadId.get(ThreadId.make(thread.request.threadId)) ===
        "updated"
    );
    const removed = threads.filter(
      (thread) =>
        outcomesByThreadId.get(ThreadId.make(thread.request.threadId)) ===
        "removed"
    );

    yield* applySuccessfulBatchEffects(operation, accountId, updated);
    yield* Effect.sync(() => {
      for (const thread of removed) {
        dismissThreadNotifications(accountId, thread.request.threadId);
      }
    });
    yield* publishCachedThreadListChanges(
      accountId,
      threads.map((thread) => ThreadId.make(thread.request.threadId))
    );
  }
);

export const bulkMutateThreads = Effect.fn("bulkMutateThreads")(
  function* bulkMutateThreads(
    request: GmailBulkThreadMutationRequest
  ): Effect.fn.Return<GmailBulkThreadMutationResult, MailSyncError> {
    const uniqueRequests = [
      ...new Map(
        request.threads.map((thread) => [getThreadRequestKey(thread), thread])
      ).values(),
    ];

    if (
      uniqueRequests.length === 0 ||
      uniqueRequests.length > MAX_BULK_THREAD_COUNT
    ) {
      return yield* new MailSyncError({
        message: `Select between 1 and ${MAX_BULK_THREAD_COUNT} conversations`,
      });
    }

    const resolved = yield* resolveBulkThreads(uniqueRequests);
    const byAccount = new Map<string, ResolvedBulkThread[]>();

    for (const thread of resolved) {
      const accountThreads = byAccount.get(thread.request.accountId) ?? [];
      accountThreads.push(thread);
      byAccount.set(thread.request.accountId, accountThreads);
    }

    const succeededKeys = new Set<string>();

    for (const [accountId, accountThreads] of byAccount) {
      const plan = planBulkThreadMutation(
        request.operation.kind,
        accountThreads.map((thread) => thread.messageIds?.length)
      );
      const batches = plan.batches.map((batch) =>
        batch.flatMap((index) => {
          const thread = accountThreads[index];
          return thread === undefined ? [] : [thread];
        })
      );
      const fallback = plan.fallback.flatMap((index) => {
        const thread = accountThreads[index];
        return thread === undefined ? [] : [thread];
      });

      for (const batch of batches) {
        const result = yield* Effect.gen(function* runBulkBatch() {
          const outcome = yield* runBatchMutation(
            request.operation,
            accountId,
            batch
          );

          yield* outcome.type === "updated"
            ? applySuccessfulBatch(request.operation, accountId, batch)
            : applyReconciledBatch(
                request.operation,
                accountId,
                batch,
                outcome
              );

          return outcome;
        }).pipe(
          Effect.map((outcome) => ({ outcome, type: "success" }) as const),
          Effect.orElseSucceed(() => ({ type: "failed" }) as const)
        );

        if (result.type === "failed") {
          continue;
        }

        if (result.outcome.type === "updated") {
          for (const thread of batch) {
            succeededKeys.add(getThreadRequestKey(thread.request));
          }
          continue;
        }

        const succeededThreadIds = new Set(
          result.outcome.results.flatMap((entry) =>
            entry.outcome === "refreshed" ? [] : [entry.threadId]
          )
        );

        for (const thread of batch) {
          if (succeededThreadIds.has(ThreadId.make(thread.request.threadId))) {
            succeededKeys.add(getThreadRequestKey(thread.request));
          }
        }
      }

      const fallbackResults = yield* Effect.forEach(
        fallback,
        (thread) =>
          attemptBulkMutation(
            runSingleBulkMutation(request.operation, thread.request)
          ).pipe(Effect.map((succeeded) => ({ succeeded, thread }))),
        { concurrency: BULK_THREAD_FALLBACK_CONCURRENCY }
      );

      for (const result of fallbackResults) {
        if (result.succeeded) {
          succeededKeys.add(getThreadRequestKey(result.thread.request));
        }
      }
    }

    return {
      failed: uniqueRequests.filter(
        (thread) => !succeededKeys.has(getThreadRequestKey(thread))
      ),
      succeeded: uniqueRequests.filter((thread) =>
        succeededKeys.has(getThreadRequestKey(thread))
      ),
    };
  }
);

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

/**
 * Seeds one bounded Spam page per normal sync until the account's current Spam
 * mailbox is cached. Gmail history owns all later transitions, so this is a
 * one-time, resumable bridge for accounts connected before Spam was visible.
 */
const syncSpamBackfillPage = Effect.fn("syncSpamBackfillPage")(
  function* syncSpamBackfillPage(accountId: string) {
    const state = yield* withDatabase(
      "Could not read spam sync state",
      (database) =>
        database.query.gmailSyncState.findFirst({
          columns: {
            spamBackfillComplete: true,
            spamBackfillCursor: true,
          },
          where: { accountEmail: accountId },
        })
    );

    if (state === undefined || state.spamBackfillComplete) {
      return [];
    }

    yield* Effect.promise(() =>
      mailQuotaGovernor.awaitBudget(accountId, SPAM_PAGE_QUOTA_UNITS)
    );

    const page = yield* runGmail(
      Gmail.pipe(
        Effect.flatMap((gmail) =>
          gmail.listThreads(
            state.spamBackfillCursor === null
              ? {
                  accountId: AccountId.make(accountId),
                  includeSpamTrash: true,
                  labelIds: [LabelId.make(GMAIL_SPAM_LABEL)],
                  pageSize: THREAD_PAGE_SIZE,
                }
              : {
                  accountId: AccountId.make(accountId),
                  cursor: PageCursor.make(state.spamBackfillCursor),
                }
          )
        )
      )
    );
    const now = yield* Clock.currentTimeMillis;

    yield* withDatabase("Could not save spam sync state", (database) =>
      database
        .update(gmailSyncState)
        .set({
          spamBackfillComplete: !page.hasMore,
          spamBackfillCursor: page.nextCursor ?? null,
          updatedAt: now,
        })
        .where(eq(gmailSyncState.accountEmail, accountId))
        .run()
    );

    return page.items.map((thread) => thread.id);
  }
);

const resetSpamBackfill = Effect.fn("resetSpamBackfill")(
  function* resetSpamBackfill(accountId: string) {
    const now = yield* Clock.currentTimeMillis;
    const threadIds = yield* withDatabase("Could not reset spam", (database) =>
      resetSpamBackfillRemote(database, accountId, now)
    );

    if (threadIds.length > 0) {
      // Keep suggestions aligned with the transaction's message deletions.
      forgetCachedCorrespondents(accountId);
    }

    return threadIds.map((threadId) => ThreadId.make(threadId));
  }
);

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

  // Publish foreground history before the bounded Spam seed is allowed to
  // wait for background quota.
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

  const resetSpamThreadIds =
    result.type === "cursor-recovered"
      ? yield* resetSpamBackfill(accountId).pipe(
          Effect.catch((error) =>
            Effect.logWarning(
              `Could not reset Spam sync: ${error.message}`
            ).pipe(Effect.as([]))
          )
        )
      : [];
  const spamThreadIds = yield* syncSpamBackfillPage(accountId).pipe(
    Effect.catch((error) =>
      Effect.logWarning(`Could not seed Spam: ${error.message}`).pipe(
        Effect.as([])
      )
    )
  );
  const changedThreadIds = [
    ...new Set([...resetSpamThreadIds, ...spamThreadIds]),
  ];

  if (changedThreadIds.length > 0) {
    yield* publishCachedThreadListChanges(accountId, changedThreadIds);
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

      return Array.isArray(granted) && granted.some(isGmailScope);
    });
    const retrySchedule = Schedule.exponential(1000).pipe(Schedule.jittered);
    const context = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(context);

    yield* Effect.forEach(
      readableAccounts,
      ({ email }) =>
        Effect.promise((parentSignal) =>
          accountMailWorkSupervisor.run(
            email,
            (signal) =>
              runPromise(
                Effect.gen(function* syncAccountWithStatus() {
                  yield* Effect.sync(() => setAccountSyncing(email, true));
                  yield* syncAccount(email).pipe(
                    Effect.retry({
                      schedule: retrySchedule,
                      times: MAX_SYNC_RETRIES,
                      while: (error) => error.retryable === true,
                    }),
                    Effect.ignore,
                    Effect.ensuring(
                      Effect.sync(() => setAccountSyncing(email, false))
                    )
                  );
                }),
                { signal }
              ),
            parentSignal
          )
        ),
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
