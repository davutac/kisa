import { AuthPlus, gmail } from "@googleapis/gmail";
import type { gmail_v1 } from "@googleapis/gmail";
import {
  GmailApiError,
  GmailHistoryExpiredError,
  GmailRateLimitError,
  GmailReauthorizationRequiredError,
  GmailSendOutcomeUnknownError,
} from "@repo/gmail/errors";
import type {
  GatewayHistoryResult,
  GatewayMailboxTotals,
  GatewayResult,
  GatewayThread,
  GatewayThreadPage,
  GmailGatewayError,
  GmailGatewayService,
  GmailIdentity,
  RawMessage,
} from "@repo/gmail/gateway";
import { GmailGateway } from "@repo/gmail/gateway";
import type {
  GmailAttachment,
  GmailCredentials,
  HistoryId as HistoryIdType,
  ThreadId as ThreadIdType,
  Mailbox,
} from "@repo/gmail/models";
import {
  AccountId,
  GmailLabel,
  HistoryId,
  LabelId,
  MessageId,
  SentMessage,
  ThreadId,
  ThreadSummary,
} from "@repo/gmail/models";
import { Effect, Layer, Redacted } from "effect";

import {
  collectAttachments,
  hasAttachmentPart,
  isPresent,
  parseMailbox,
} from "./gmail-payload";
import { mailQuotaGovernor, QUOTA_UNITS } from "./quota-governor";

// The OAuth2 client bundled with @googleapis/gmail, rather than a separate
// google-auth-library install: a second copy is a distinct nominal type and
// will not satisfy the client's `auth` parameter.
const authPlus = new AuthPlus();
const createOAuthClient = () => new authPlus.OAuth2();

const UNREAD_LABEL_ID = "UNREAD";
const HISTORY_TYPES = ["labelAdded", "labelRemoved", "messageAdded"];
const HISTORY_PAGE_SIZE = 500;
/** Matches the fan-out the hand-rolled sync used; Gmail throttles above this. */
const THREAD_FETCH_CONCURRENCY = 5;

const mapWithConcurrency = async <A, B>(
  items: readonly A[],
  limit: number,
  run: (item: A) => Promise<B>
): Promise<readonly B[]> => {
  const results: B[] = Array.from({ length: items.length });
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      // oxlint-disable-next-line eslint/no-await-in-loop
      results[index] = await run(items[index] as A);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );

  return results;
};

/**
 * Gmail reports quota exhaustion as 403 with a reason rather than 429, so both
 * shapes have to be recognised before falling through to a generic API error.
 */
const RATE_LIMIT_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
]);
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

interface GaxiosLikeError {
  readonly code?: number | string;
  readonly errors?: readonly { readonly reason?: string }[];
  readonly message?: string;
  readonly status?: number;
}

const readErrorStatus = (error: unknown): number | undefined => {
  const candidate = error as GaxiosLikeError | null;

  if (candidate === null || typeof candidate !== "object") {
    return undefined;
  }

  const status = candidate.status ?? candidate.code;

  return typeof status === "number"
    ? status
    : Math.trunc(Number(status ?? "")) || undefined;
};

const readErrorReasons = (error: unknown): readonly string[] => {
  const candidate = error as GaxiosLikeError | null;

  if (candidate === null || typeof candidate !== "object") {
    return [];
  }

  return (candidate.errors ?? [])
    .map((entry) => entry.reason)
    .filter((reason): reason is string => reason !== undefined);
};

const readErrorMessage = (error: unknown, fallback: string): string => {
  const candidate = error as GaxiosLikeError | null;

  return candidate !== null &&
    typeof candidate === "object" &&
    typeof candidate.message === "string"
    ? candidate.message
    : fallback;
};

/**
 * Translates a `@googleapis/gmail` rejection into the domain errors that
 * `GmailService` already branches on. `history.list` is the one caller that
 * treats 404 as a recoverable cursor expiry, so it opts in explicitly.
 */
const toGatewayError = (
  accountId: AccountId,
  error: unknown,
  options: { readonly historyExpiredOnNotFound?: boolean } = {}
): GmailGatewayError => {
  const status = readErrorStatus(error);
  const reasons = readErrorReasons(error);
  const message = readErrorMessage(error, "Gmail request failed");

  if (status === 401) {
    return new GmailReauthorizationRequiredError({ accountId, message });
  }

  if (
    status === 429 ||
    reasons.some((reason) => RATE_LIMIT_REASONS.has(reason))
  ) {
    // Every rate limit is reported, whoever provoked it: the budget is
    // per-user, so a foreground burst tripping the limit has to slow the
    // indexer too.
    mailQuotaGovernor.reportRateLimited(accountId);

    return new GmailRateLimitError({ accountId, message });
  }

  if (status === 404 && options.historyExpiredOnNotFound === true) {
    return new GmailHistoryExpiredError({ accountId, message });
  }

  return new GmailApiError({
    accountId,
    cause: error,
    message,
    retryable: status !== undefined && RETRYABLE_STATUSES.has(status),
  });
};

const toSendError = (
  accountId: AccountId,
  error: unknown
): GmailGatewayError | GmailSendOutcomeUnknownError => {
  const gatewayError = toGatewayError(accountId, error);

  if (
    gatewayError._tag === "GmailApiError" &&
    (gatewayError.retryable || readErrorStatus(error) === undefined)
  ) {
    return new GmailSendOutcomeUnknownError({
      accountId,
      message:
        "Gmail did not confirm whether the message was sent. Check Sent mail before trying again.",
    });
  }

  return gatewayError;
};

const createClient = (credentials: GmailCredentials): gmail_v1.Gmail => {
  const auth = createOAuthClient();

  // Refresh lives in the auth worker so the client secret stays server-side;
  // this client only carries the access token and surfaces 401 upward.
  auth.setCredentials({
    access_token: Redacted.value(credentials.accessToken),
  });

  return gmail({ auth, version: "v1" });
};

const getHeader = (
  message: gmail_v1.Schema$Message,
  name: string
): string | undefined =>
  message.payload?.headers?.find(
    (header) => header.name?.toLowerCase() === name.toLowerCase()
  )?.value ?? undefined;

/**
 * Gmail's `threads.list` returns only ids, so summaries are assembled from a
 * metadata-format `threads.get` per thread.
 */
const toThreadSummary = (
  thread: gmail_v1.Schema$Thread
): ThreadSummary | undefined => {
  const messages = thread.messages ?? [];
  const latest = messages.at(-1);

  if (thread.id === null || thread.id === undefined || !isPresent(latest?.id)) {
    return undefined;
  }

  // Latest sender first: thread rows show `participants[0]` as the sender, and
  // the hand-rolled sync took it from the newest message.
  const participants = [
    ...new Map(
      [latest, ...messages]
        .map((message) => getHeader(message, "from"))
        .filter((value): value is string => value !== undefined)
        .map((value) => parseMailbox(value))
        .filter((mailbox): mailbox is Mailbox => mailbox !== undefined)
        .map((mailbox) => [mailbox.address, mailbox] as const)
    ).values(),
  ];

  const attachments = messages.flatMap((message) =>
    isPresent(message.id) ? collectAttachments(message.id, message.payload) : []
  );

  return new ThreadSummary({
    attachments,
    hasAttachments: messages.some((message) =>
      message.payload === undefined || message.payload === null
        ? false
        : hasAttachmentPart(message.payload)
    ),
    hasUnread: messages.some((message) =>
      (message.labelIds ?? []).includes(UNREAD_LABEL_ID)
    ),
    id: ThreadId.make(thread.id),
    labelIds: [
      ...new Set(messages.flatMap((message) => message.labelIds ?? [])),
    ].map((labelId) => LabelId.make(labelId)),
    latestAt: latest.internalDate ?? "0",
    latestMessageId: MessageId.make(latest.id),
    messageCount: Math.max(messages.length, 1),
    participants,
    snippet: latest.snippet ?? "",
    subject: getHeader(latest, "subject") ?? "",
  });
};

const toGmailLabel = (label: gmail_v1.Schema$Label): GmailLabel | undefined => {
  if (!isPresent(label.id) || !isPresent(label.name)) {
    return undefined;
  }

  return new GmailLabel({
    id: LabelId.make(label.id),
    messageListVisibility:
      label.messageListVisibility === "hide" ||
      label.messageListVisibility === "show"
        ? label.messageListVisibility
        : undefined,
    name: label.name,
    type: label.type === "system" ? "system" : "user",
    ...(isPresent(label.messagesTotal)
      ? { messageCount: label.messagesTotal }
      : {}),
    ...(isPresent(label.threadsTotal)
      ? { threadCount: label.threadsTotal }
      : {}),
  });
};

const succeed = <A>(value: A): GatewayResult<A> => ({ value });

const VOID_RESULT: GatewayResult<void> = { value: undefined };

/**
 * Folds one page of history records into the changed/removed thread id sets.
 * Label changes and new messages both mean "re-read this thread".
 */
const collectHistoryThreadIds = (
  records: readonly gmail_v1.Schema$History[],
  target: {
    readonly changedThreadIds: Set<string>;
    readonly removedThreadIds: Set<string>;
  }
): void => {
  for (const record of records) {
    for (const changed of [
      ...(record.messagesAdded ?? []),
      ...(record.labelsAdded ?? []),
      ...(record.labelsRemoved ?? []),
    ]) {
      if (isPresent(changed.message?.threadId)) {
        target.changedThreadIds.add(changed.message.threadId);
      }
    }

    for (const deleted of record.messagesDeleted ?? []) {
      if (isPresent(deleted.message?.threadId)) {
        target.removedThreadIds.add(deleted.message.threadId);
      }
    }
  }
};

/**
 * Both `listThreads` and `listHistory` only learn thread ids from Gmail, so
 * each id is re-read to build a summary. Threads that have disappeared between
 * the two calls 404 and are dropped rather than failing the whole page.
 *
 * `full` rather than `metadata`: summaries carry the thread's attachment list,
 * and `metadata` format omits the per-part `attachmentId` needed to build it.
 * This matches the request profile the hand-rolled sync already used.
 */
const toGatewayThread = (
  thread: gmail_v1.Schema$Thread
): GatewayThread | undefined =>
  isPresent(thread.id)
    ? {
        historyId: HistoryId.make(thread.historyId ?? "0"),
        id: ThreadId.make(thread.id),
        labelIds: [
          ...new Set(
            (thread.messages ?? []).flatMap((message) => message.labelIds ?? [])
          ),
        ],
        messages: thread.messages ?? [],
      }
    : undefined;

interface FetchedThreads {
  readonly details: readonly GatewayThread[];
  readonly summaries: readonly ThreadSummary[];
}

const fetchThreadSummaries = async (
  accountId: AccountId,
  client: gmail_v1.Gmail,
  threadIds: readonly string[]
): Promise<FetchedThreads> => {
  const fetched = await mapWithConcurrency(
    threadIds,
    THREAD_FETCH_CONCURRENCY,
    async (threadId) => {
      try {
        mailQuotaGovernor.charge(accountId, QUOTA_UNITS.threadsGet);

        const detail = await client.users.threads.get({
          format: "full",
          id: threadId,
          userId: "me",
        });
        const summary = toThreadSummary(detail.data);

        return summary === undefined
          ? undefined
          : { detail: toGatewayThread(detail.data), summary };
      } catch (error) {
        if (readErrorStatus(error) === 404) {
          return;
        }

        throw error;
      }
    }
  );
  const present = fetched.filter((entry) => entry !== undefined);

  return {
    details: present.flatMap((entry) =>
      entry.detail === undefined ? [] : [entry.detail]
    ),
    summaries: present.map((entry) => entry.summary),
  };
};

export const GmailGatewayLive = Layer.succeed(
  GmailGateway,
  GmailGateway.of({
    getAttachment: (authorization, request) =>
      Effect.tryPromise({
        catch: (error) => toGatewayError(authorization.account.id, error),
        try: async (): Promise<GatewayResult<GmailAttachment>> => {
          const client = createClient(authorization.credentials);

          mailQuotaGovernor.charge(
            authorization.account.id,
            QUOTA_UNITS.attachmentsGet
          );
          const response = await client.users.messages.attachments.get({
            id: request.attachmentId,
            messageId: request.messageId,
            userId: "me",
          });

          return succeed({
            bytes: Buffer.from(response.data.data ?? "", "base64url"),
            filename: request.filename,
            mediaType: request.mediaType,
          });
        },
      }),

    getCurrentHistoryId: (authorization) =>
      Effect.tryPromise({
        catch: (error) => toGatewayError(authorization.account.id, error),
        try: async (): Promise<GatewayResult<HistoryIdType>> => {
          const client = createClient(authorization.credentials);

          mailQuotaGovernor.charge(
            authorization.account.id,
            QUOTA_UNITS.getProfile
          );
          const response = await client.users.getProfile({ userId: "me" });

          return succeed(HistoryId.make(response.data.historyId ?? "0"));
        },
      }),

    getMailboxTotals: (authorization) =>
      Effect.tryPromise({
        catch: (error) => toGatewayError(authorization.account.id, error),
        try: async (): Promise<GatewayResult<GatewayMailboxTotals>> => {
          const client = createClient(authorization.credentials);

          mailQuotaGovernor.charge(
            authorization.account.id,
            QUOTA_UNITS.getProfile
          );

          const response = await client.users.getProfile({ userId: "me" });

          return succeed({
            messagesTotal: response.data.messagesTotal ?? 0,
            threadsTotal: response.data.threadsTotal ?? 0,
          });
        },
      }),

    getThread: (authorization, threadId) =>
      Effect.tryPromise({
        catch: (error) => toGatewayError(authorization.account.id, error),
        try: async (): Promise<GatewayResult<GatewayThread>> => {
          const client = createClient(authorization.credentials);

          mailQuotaGovernor.charge(
            authorization.account.id,
            QUOTA_UNITS.threadsGet
          );
          const response = await client.users.threads.get({
            format: "full",
            id: threadId,
            userId: "me",
          });
          const messages = response.data.messages ?? [];

          return succeed({
            historyId: HistoryId.make(response.data.historyId ?? "0"),
            id: threadId,
            labelIds: [
              ...new Set(messages.flatMap((message) => message.labelIds ?? [])),
            ],
            messages,
          });
        },
      }),

    identifyAccount: (credentials) =>
      Effect.tryPromise({
        catch: (error) => toGatewayError(AccountId.make("unknown"), error),
        try: async (): Promise<GmailIdentity> => {
          const client = createClient(credentials);
          const response = await client.users.getProfile({ userId: "me" });
          const email = response.data.emailAddress ?? "";

          return { email, id: AccountId.make(email) };
        },
      }),

    listHistory: (authorization, historyId) =>
      Effect.tryPromise({
        catch: (error) =>
          toGatewayError(authorization.account.id, error, {
            historyExpiredOnNotFound: true,
          }),
        try: async (): Promise<GatewayResult<GatewayHistoryResult>> => {
          const client = createClient(authorization.credentials);
          const changedThreadIds = new Set<string>();
          const removedThreadIds = new Set<string>();
          let latestHistoryId = historyId;
          let pageToken: string | undefined;

          do {
            mailQuotaGovernor.charge(
              authorization.account.id,
              QUOTA_UNITS.historyList
            );

            // Each page's token comes from the previous response, so these
            // requests cannot be parallelised.
            // oxlint-disable-next-line eslint/no-await-in-loop
            const response = await client.users.history.list({
              historyTypes: HISTORY_TYPES,
              maxResults: HISTORY_PAGE_SIZE,
              startHistoryId: historyId,
              userId: "me",
              ...(pageToken === undefined ? {} : { pageToken }),
            });

            latestHistoryId = HistoryId.make(
              response.data.historyId ?? latestHistoryId
            );

            collectHistoryThreadIds(response.data.history ?? [], {
              changedThreadIds,
              removedThreadIds,
            });

            pageToken = response.data.nextPageToken ?? undefined;
          } while (pageToken !== undefined);

          // History records only identify threads, so the changed ones are
          // re-read to produce current summaries. Ids that history reported as
          // deleted are excluded rather than fetched.
          for (const removed of removedThreadIds) {
            changedThreadIds.delete(removed);
          }

          const fetched = await fetchThreadSummaries(
            authorization.account.id,
            client,
            [...changedThreadIds]
          );

          return succeed({
            details: fetched.details,
            historyId: latestHistoryId,
            removedThreadIds: [...removedThreadIds].map((id) =>
              ThreadId.make(id)
            ),
            threads: fetched.summaries,
          });
        },
      }),

    listLabels: (authorization) =>
      Effect.tryPromise({
        catch: (error) => toGatewayError(authorization.account.id, error),
        try: async (): Promise<GatewayResult<readonly GmailLabel[]>> => {
          const client = createClient(authorization.credentials);

          mailQuotaGovernor.charge(
            authorization.account.id,
            QUOTA_UNITS.labelsList
          );
          const response = await client.users.labels.list({ userId: "me" });

          return succeed(
            (response.data.labels ?? [])
              .map(toGmailLabel)
              .filter((label): label is GmailLabel => label !== undefined)
          );
        },
      }),

    listThreads: (authorization, request) =>
      Effect.tryPromise({
        catch: (error) => toGatewayError(authorization.account.id, error),
        try: async (): Promise<GatewayResult<GatewayThreadPage>> => {
          const client = createClient(authorization.credentials);

          mailQuotaGovernor.charge(
            authorization.account.id,
            QUOTA_UNITS.threadsList
          );

          const listed = await client.users.threads.list({
            includeSpamTrash: request.includeSpamTrash,
            labelIds: [...request.labelIds],
            maxResults: request.pageSize,
            userId: "me",
            ...(request.pageToken === undefined
              ? {}
              : { pageToken: request.pageToken }),
            ...(request.search === undefined ? {} : { q: request.search }),
          });
          const threadIds = (listed.data.threads ?? [])
            .map((entry) => entry.id)
            .filter((id): id is string => isPresent(id));

          const fetched = await fetchThreadSummaries(
            authorization.account.id,
            client,
            threadIds
          );

          return succeed({
            details: fetched.details,
            threads: fetched.summaries,
            ...(isPresent(listed.data.nextPageToken)
              ? { nextPageToken: listed.data.nextPageToken }
              : {}),
          });
        },
      }),

    modifyThreadLabels: (authorization, request) =>
      Effect.tryPromise({
        catch: (error) => toGatewayError(authorization.account.id, error),
        try: async (): Promise<GatewayResult<void>> => {
          const client = createClient(authorization.credentials);

          mailQuotaGovernor.charge(
            authorization.account.id,
            QUOTA_UNITS.threadsModify
          );

          await client.users.threads.modify({
            id: request.threadId,
            requestBody: {
              addLabelIds: [...request.addLabelIds],
              removeLabelIds: [...request.removeLabelIds],
            },
            userId: "me",
          });

          return VOID_RESULT;
        },
      }),

    revoke: (authorization) =>
      Effect.tryPromise({
        catch: (error) =>
          new GmailApiError({
            accountId: authorization.account.id,
            cause: error,
            message: readErrorMessage(error, "Could not revoke Gmail access"),
            retryable: false,
          }),
        try: async () => {
          const auth = createOAuthClient();

          await auth.revokeToken(
            Redacted.value(authorization.credentials.accessToken)
          );
        },
      }),

    send: (authorization, message: RawMessage) =>
      Effect.tryPromise({
        catch: (error) => toSendError(authorization.account.id, error),
        try: async (): Promise<GatewayResult<SentMessage>> => {
          const client = createClient(authorization.credentials);

          mailQuotaGovernor.charge(
            authorization.account.id,
            QUOTA_UNITS.messagesSend
          );
          const response = await client.users.messages.send({
            requestBody: {
              raw: message.raw,
              ...(message.threadId === undefined
                ? {}
                : { threadId: message.threadId }),
            },
            userId: "me",
          });

          return succeed(
            new SentMessage({
              id: MessageId.make(response.data.id ?? ""),
              threadId: ThreadId.make(response.data.threadId ?? ""),
            })
          );
        },
      }),

    trashThread: (authorization, threadId: ThreadIdType) =>
      Effect.tryPromise({
        catch: (error) => toGatewayError(authorization.account.id, error),
        try: async (): Promise<GatewayResult<void>> => {
          const client = createClient(authorization.credentials);

          mailQuotaGovernor.charge(
            authorization.account.id,
            QUOTA_UNITS.threadsTrash
          );

          await client.users.threads.trash({ id: threadId, userId: "me" });

          return VOID_RESULT;
        },
      }),
  } satisfies GmailGatewayService)
);
