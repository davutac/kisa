import { gmailThreads } from "@repo/database/schemas";
import type { GmailError } from "@repo/gmail/errors";
import { GmailGateway } from "@repo/gmail/gateway";
import { GmailMime } from "@repo/gmail/mime";
import type { GmailThread as GmailDomainThread } from "@repo/gmail/models";
import { AccountId, LabelId, ThreadId } from "@repo/gmail/models";
import { Gmail } from "@repo/gmail/service";
import { GmailStore } from "@repo/gmail/store";
import { eq } from "drizzle-orm";
import { Effect, Layer, Schedule, Schema } from "effect";

import {
  MAIL_SYNC_STATUS_CHANNEL,
  MAIL_THREADS_CHANGED_CHANNEL,
} from "../../shared/ipc/channels";
import { GmailSyncStatus, GmailThreadsChanged } from "../../shared/ipc/mail";
import type {
  GmailCachedThreadPage,
  GmailCachedThreadPageRequest,
  GmailLabelCatalog,
  GmailLabelCatalogRequest,
  GmailSenderBrand,
  GmailThread as GmailThreadDto,
  GmailThreadMessage,
  GmailThreadReadStateRequest,
  GmailThreadRequest,
  GmailThreadSummary,
} from "../../shared/ipc/mail";
import { getDatabaseClient } from "../database";
import { sendRendererEvent } from "../electron/renderer-events";
import { GmailGatewayLive } from "./gmail-gateway";
import { GmailMimeLive } from "./gmail-mime";
import { GmailStoreLive } from "./gmail-store";
import {
  inlineImageDataUrls,
  normalizeContentId,
  selectInlineImages,
  toImageDataUrl,
} from "./inline-images";
import { addUnreadLabel, removeUnreadLabel } from "./read-state";
import type { MessageHeader } from "./sender-brand";
import { getSenderBrand } from "./sender-brand";

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
  run: (database: Effect.Success<ReturnType<typeof getDatabaseClient>>) => A
) =>
  getDatabaseClient().pipe(
    // oxlint-disable-next-line promise/prefer-await-to-callbacks
    Effect.mapError((error) => new MailSyncError({ message: error.message })),
    Effect.flatMap((database) =>
      Effect.try({
        catch: () => new MailSyncError({ message }),
        try: () => run(database),
      })
    )
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

export const listCachedThreadPage = Effect.fn("listCachedThreadPage")(
  function* listCachedThreadPage(request: GmailCachedThreadPageRequest) {
    if (request.accountIds.length === 0) {
      return { threads: [] } satisfies GmailCachedThreadPage;
    }

    const rows = yield* withDatabase("Could not load email", (database) =>
      database.query.gmailThreads
        .findMany({
          limit: THREAD_PAGE_SIZE + 1,
          orderBy: (thread, { asc, desc }) => [
            desc(thread.latestAt),
            asc(thread.accountEmail),
            asc(thread.threadId),
          ],
          where: (thread, { and, eq: is, gt, inArray, lt, or }) =>
            and(
              // The inbox predicate has to be in SQL, not a filter over the
              // page below: the index stores archived mail in this table too,
              // so filtering afterwards would return near-empty pages while
              // paging through everything the user archived.
              is(thread.isInInbox, true),
              inArray(thread.accountEmail, [...request.accountIds]),
              request.unreadOnly === true
                ? is(thread.isUnread, true)
                : undefined,
              request.cursor === undefined
                ? undefined
                : or(
                    lt(thread.latestAt, request.cursor.latestAt),
                    and(
                      is(thread.latestAt, request.cursor.latestAt),
                      gt(thread.accountEmail, request.cursor.accountId)
                    ),
                    and(
                      is(thread.latestAt, request.cursor.latestAt),
                      is(thread.accountEmail, request.cursor.accountId),
                      gt(thread.threadId, request.cursor.threadId)
                    )
                  )
            ),
        })
        .sync()
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

const notifyThreadsChanged = (accountId: string): void => {
  sendRendererEvent(MAIL_THREADS_CHANGED_CHANNEL, GmailThreadsChanged, {
    accountId,
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

const publishThreadsChanged = Effect.fn("publishThreadsChanged")(
  function* publishThreadsChanged(accountId: string) {
    yield* Effect.try({
      catch: () =>
        new MailSyncError({ message: "Could not publish email update" }),
      try: () => notifyThreadsChanged(accountId),
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
  }
);

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
      labels: labels.map((label) => ({
        id: label.id,
        name: label.name,
        type: label.type,
      })),
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
      labels: labels.map((label) => ({
        id: label.id,
        name: label.name,
        type: label.type,
      })),
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
                  Effect.catch(() => Effect.succeed(null))
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
  withDatabase("Could not load Gmail labels", (database) => {
    const namesById = new Map(
      database.query.gmailLabels
        .findMany({
          where: (label, { eq: is }) => is(label.accountEmail, accountId),
        })
        .sync()
        .map((row) => [row.labelId, row.name] as const)
    );

    return labelIds.map((labelId) => namesById.get(labelId) ?? labelId);
  });

export const loadFullThread = Effect.fn("loadFullThread")(
  function* loadFullThread(request: GmailThreadRequest) {
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
          Effect.catch(() => Effect.succeed(null)),
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
        Effect.catch((error) =>
          Effect.logWarning(
            `Could not mark Gmail thread as read: ${error.message}`
          )
        )
      );
      yield* publishThreadsChanged(request.accountId);
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

const findCachedThread = (accountId: string, threadId: string) =>
  withDatabase("Could not load email", (database) =>
    database.query.gmailThreads
      .findFirst({
        where: (thread, { and, eq: is }) =>
          and(
            is(thread.accountEmail, accountId),
            is(thread.threadId, threadId)
          ),
      })
      .sync()
  );

const updateCachedThread = (
  summary: GmailThreadSummary
): Effect.Effect<void, MailSyncError> =>
  withDatabase("Could not cache email", (database) => {
    database
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

    const row = yield* findCachedThread(request.accountId, request.threadId);

    if (row !== undefined) {
      yield* updateCachedThread(
        toReadStateSummary(toCachedThreadSummary(row), request.isUnread)
      );
    }

    yield* publishThreadsChanged(request.accountId);
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

  // `Gmail.trashThread` deletes the cached row; re-insert it with TRASH so the
  // list keeps rendering the thread until the next sync reconciles it.
  if (row !== undefined) {
    const summary = toTrashedSummary(toCachedThreadSummary(row));

    yield* withDatabase("Could not cache email", (database) => {
      // `is_in_inbox` has to be cleared explicitly: the spread carries the old
      // `true` from `row`, and the paging query reads that column, so a trashed
      // thread would otherwise keep its place in the list.
      const values = {
        isInInbox: false,
        labels: summary.labels,
        updatedAt: Date.now(),
      };

      database
        .insert(gmailThreads)
        .values({ ...row, ...values })
        .onConflictDoUpdate({
          set: values,
          target: [gmailThreads.accountEmail, gmailThreads.threadId],
        })
        .run();
    });
  }

  yield* publishThreadsChanged(request.accountId);
});

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
    yield* publishThreadsChanged(accountId);
  }
});

const syncAllAccounts = Effect.fn("syncAllAccounts")(
  function* syncAllAccounts() {
    const accounts = yield* withDatabase(
      "Could not load Google accounts",
      (database) =>
        database.query.googleAccounts
          .findMany({ columns: { email: true, scopes: true } })
          .sync()
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
