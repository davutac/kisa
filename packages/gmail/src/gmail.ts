import {
  Context,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
  Semaphore,
} from "effect";

import { encodeCursor, resolvePageRequest } from "./cursor";
import type { GmailError } from "./errors";
import {
  AccountNotFoundError,
  GmailPermissionError,
  GmailValidationError,
  InvalidAuthHandoffError,
  withReconciledThread,
} from "./errors";
import type {
  GmailGatewayError,
  GatewayHistoryResult,
  GatewayResult,
  GatewayThread,
} from "./gateway";
import { GmailGateway } from "./gateway";
import { GmailMime } from "./mime";
import type {
  AccountId,
  BatchThreadLabelMutationRequest,
  BatchThreadMutationRequest,
  CreateLabelRequest,
  DeleteLabelRequest,
  DisconnectAccountOptions,
  ForwardInput,
  GetAttachmentRequest,
  GetThreadRequest,
  GmailAttachment,
  GmailAuthorization,
  GmailCredentialPatch,
  GmailLabel,
  GmailScope,
  GmailThread,
  ListLabelsOptions,
  ListThreadsRequest,
  ReplyInput,
  SendMessageInput,
  SentMessage,
  SyncRequest,
  SyncResult,
  ThreadLabelMutationRequest,
  ThreadId,
  ThreadMutationRequest,
  ThreadPage,
  ThreadSummary,
  UpdateLabelRequest,
} from "./models";
import {
  GmailAccount,
  getGmailCapabilities,
  isGmailScope,
  LabelId,
} from "./models";
import { GmailStore } from "./store";

const AuthHandoff = Schema.Struct({
  accessToken: Schema.NonEmptyString,
  expiresAt: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  refreshToken: Schema.optional(Schema.NonEmptyString),
  scopes: Schema.Array(Schema.NonEmptyString),
});

const ACCOUNT_REQUEST_CONCURRENCY = 4;

const decodeAuthHandoff = Schema.decodeUnknownEffect(AuthHandoff);
type AuthHandoffInput = typeof AuthHandoff.Encoded;

const selectScopes = (scopes: readonly string[]): readonly GmailScope[] =>
  scopes.filter(isGmailScope);

const mergeCredentials = (
  current: GmailAuthorization | undefined,
  incoming: GmailAuthorization
): GmailAuthorization => {
  if (
    incoming.credentials.refreshToken !== undefined ||
    current?.credentials.refreshToken === undefined
  ) {
    return incoming;
  }

  return {
    ...incoming,
    credentials: {
      ...incoming.credentials,
      refreshToken: current.credentials.refreshToken,
    },
  };
};

const requireCapability = (
  authorization: GmailAuthorization,
  capability: "modify" | "read" | "send"
): Effect.Effect<void, GmailPermissionError> => {
  if (authorization.account.capabilities[capability]) {
    return Effect.void;
  }

  return new GmailPermissionError({
    accountId: authorization.account.id,
    capability,
    message: `Gmail account ${authorization.account.email} did not grant ${capability} access`,
  });
};

export type ThreadMutationOutcome = "refreshed" | "removed" | "updated";
export type BatchThreadMutationOutcome =
  | {
      readonly results: readonly {
        readonly outcome: ThreadMutationOutcome;
        readonly threadId: ThreadId;
      }[];
      readonly type: "reconciled";
    }
  | { readonly type: "updated" };
export type UpdateLabelOutcome =
  | { readonly label: GmailLabel; readonly type: "updated" }
  | { readonly type: "removed" };

const getUpdatedThreadIds = (
  request: BatchThreadMutationRequest,
  outcome: BatchThreadMutationOutcome
): readonly ThreadId[] => [
  ...new Set(
    outcome.type === "updated"
      ? request.targets.map((target) => target.threadId)
      : outcome.results.flatMap((result) =>
          result.outcome === "updated" ? [result.threadId] : []
        )
  ),
];

export interface GmailService {
  readonly authorizeAccount: (
    handoff: AuthHandoffInput
  ) => Effect.Effect<GmailAccount, GmailError>;
  readonly disconnectAccount: (
    options: DisconnectAccountOptions
  ) => Effect.Effect<void, GmailError>;
  readonly createLabel: (
    request: CreateLabelRequest
  ) => Effect.Effect<GmailLabel, GmailError>;
  readonly deleteLabel: (
    request: DeleteLabelRequest
  ) => Effect.Effect<void, GmailError>;
  readonly updateLabel: (
    request: UpdateLabelRequest
  ) => Effect.Effect<UpdateLabelOutcome, GmailError>;
  readonly deleteThread: (
    request: ThreadMutationRequest
  ) => Effect.Effect<ThreadMutationOutcome, GmailError>;
  readonly batchSetThreadLabel: (
    request: BatchThreadLabelMutationRequest
  ) => Effect.Effect<BatchThreadMutationOutcome, GmailError>;
  readonly batchSetThreadReadState: (
    request: BatchThreadMutationRequest,
    isRead: boolean
  ) => Effect.Effect<BatchThreadMutationOutcome, GmailError>;
  readonly batchTrashThreads: (
    request: BatchThreadMutationRequest
  ) => Effect.Effect<BatchThreadMutationOutcome, GmailError>;
  readonly getAccount: (
    accountId: AccountId
  ) => Effect.Effect<GmailAccount, GmailError>;
  readonly getAttachment: (
    request: GetAttachmentRequest
  ) => Effect.Effect<GmailAttachment, GmailError>;
  readonly findSentMessageByRfc822MessageId: (
    accountId: AccountId,
    rfc822MessageId: string
  ) => Effect.Effect<SentMessage | undefined, GmailError>;
  readonly getThread: (
    request: GetThreadRequest
  ) => Effect.Effect<GmailThread, GmailError>;
  readonly listAccounts: Effect.Effect<readonly GmailAccount[], GmailError>;
  readonly listLabels: (
    options: ListLabelsOptions
  ) => Effect.Effect<readonly GmailLabel[], GmailError>;
  readonly listThreads: (
    request: ListThreadsRequest
  ) => Effect.Effect<ThreadPage, GmailError>;
  readonly markThreadRead: (
    request: ThreadMutationRequest
  ) => Effect.Effect<ThreadMutationOutcome, GmailError>;
  readonly markThreadUnread: (
    request: ThreadMutationRequest
  ) => Effect.Effect<ThreadMutationOutcome, GmailError>;
  readonly moveThreadToInbox: (
    request: ThreadMutationRequest
  ) => Effect.Effect<ThreadMutationOutcome, GmailError>;
  readonly moveThreadToSpam: (
    request: ThreadMutationRequest
  ) => Effect.Effect<ThreadMutationOutcome, GmailError>;
  readonly setThreadLabel: (
    request: ThreadLabelMutationRequest
  ) => Effect.Effect<ThreadMutationOutcome, GmailError>;
  readonly forward: (
    input: ForwardInput
  ) => Effect.Effect<SentMessage, GmailError>;
  readonly reply: (input: ReplyInput) => Effect.Effect<SentMessage, GmailError>;
  readonly sendMessage: (
    input: SendMessageInput
  ) => Effect.Effect<SentMessage, GmailError>;
  readonly sync: (
    request: SyncRequest
  ) => Effect.Effect<SyncResult, GmailError>;
  readonly trashThread: (
    request: ThreadMutationRequest
  ) => Effect.Effect<ThreadMutationOutcome, GmailError>;
}

export class Gmail extends Context.Service<Gmail, GmailService>()(
  "@repo/gmail/Gmail"
) {
  static readonly layerWithoutDependencies = Layer.effect(
    Gmail,
    Effect.gen(function* layerWithoutDependencies() {
      const store = yield* GmailStore;
      const gateway = yield* GmailGateway;
      const mime = yield* GmailMime;
      const accountSemaphores = new Map<AccountId, Semaphore.Semaphore>();

      const withAccountPermit = <A, E, R>(
        accountId: AccountId,
        effect: Effect.Effect<A, E, R>
      ): Effect.Effect<A, E, R> => {
        let semaphore = accountSemaphores.get(accountId);

        if (semaphore === undefined) {
          semaphore = Semaphore.makeUnsafe(ACCOUNT_REQUEST_CONCURRENCY);
          accountSemaphores.set(accountId, semaphore);
        }

        return semaphore.withPermit(effect);
      };

      const getAuthorization = Effect.fn("Gmail.getAuthorization")(
        function* getAuthorization(accountId: AccountId) {
          const authorization = yield* store.getAuthorization(accountId);

          if (Option.isNone(authorization)) {
            return yield* new AccountNotFoundError({
              accountId,
              message: `Gmail account ${accountId} is not connected`,
            });
          }

          return authorization.value;
        }
      );

      const runAuthorized = Effect.fn("Gmail.runAuthorized")(
        function* runAuthorized<A, E, R>(
          accountId: AccountId,
          capability: "modify" | "read" | "send",
          run: (
            authorization: GmailAuthorization
          ) => Effect.Effect<GatewayResult<A>, E, R>
        ) {
          const authorization = yield* getAuthorization(accountId);
          yield* requireCapability(authorization, capability);
          const result = yield* run(authorization);

          if (result.credentialPatch !== undefined) {
            const patch = result.credentialPatch;
            const definedPatch: GmailCredentialPatch = {
              accessToken: patch.accessToken,
              expiresAt: patch.expiresAt,
              refreshToken: patch.refreshToken,
            };

            yield* store.updateCredentials(accountId, definedPatch);
          }

          return result.value;
        }
      );

      const withAuthorization = <A, E, R>(
        accountId: AccountId,
        capability: "modify" | "read" | "send",
        run: (
          authorization: GmailAuthorization
        ) => Effect.Effect<GatewayResult<A>, E, R>
      ) =>
        withAccountPermit(accountId, runAuthorized(accountId, capability, run));

      const authorizeAccount = Effect.fn("Gmail.authorizeAccount")(
        function* authorizeAccount(input: AuthHandoffInput) {
          const handoff = yield* decodeAuthHandoff(input).pipe(
            Effect.mapError(
              (error) => new InvalidAuthHandoffError({ message: error.message })
            )
          );
          const credentials = {
            accessToken: Redacted.make(handoff.accessToken, {
              label: "Gmail access token",
            }),
            expiresAt: handoff.expiresAt,
            refreshToken:
              handoff.refreshToken === undefined
                ? undefined
                : Redacted.make(handoff.refreshToken, {
                    label: "Gmail refresh token",
                  }),
          };
          const identity = yield* gateway.identifyAccount(
            credentials,
            handoff.scopes
          );
          const scopes = selectScopes(handoff.scopes);
          const account = new GmailAccount({
            avatarUrl: identity.avatarUrl,
            capabilities: getGmailCapabilities(scopes),
            displayName: identity.displayName,
            email: identity.email,
            id: identity.id,
            scopes,
          });
          const incoming: GmailAuthorization = { account, credentials };
          const stored = yield* store.getAuthorization(account.id);
          const authorization = mergeCredentials(
            Option.getOrUndefined(stored),
            incoming
          );

          yield* store.saveAuthorization(authorization);
          return account;
        }
      );

      const getAccount = Effect.fn("Gmail.getAccount")(function* getAccount(
        accountId: AccountId
      ) {
        return (yield* getAuthorization(accountId)).account;
      });

      const clearAccount = Effect.fn("Gmail.clearAccount")(
        function* clearAccount(accountId: AccountId) {
          yield* store.clearAccount(accountId);
          accountSemaphores.delete(accountId);
        }
      );

      const disconnectAccount = Effect.fn("Gmail.disconnectAccount")(
        function* disconnectAccount(options: DisconnectAccountOptions) {
          const authorization = yield* store.getAuthorization(
            options.accountId
          );

          if (Option.isSome(authorization) && options.revoke !== false) {
            const revokeResult = yield* Effect.exit(
              gateway.revoke(authorization.value)
            );
            yield* clearAccount(options.accountId);
            return yield* revokeResult;
          }

          yield* clearAccount(options.accountId);
        }
      );

      const refreshLabels = Effect.fn("Gmail.refreshLabels")(
        function* refreshLabels(accountId: AccountId) {
          const labels = yield* withAuthorization(
            accountId,
            "read",
            (authorization) => gateway.listLabels(authorization)
          );
          yield* store.replaceLabels(accountId, labels);
          return labels;
        }
      );

      const listLabels = Effect.fn("Gmail.listLabels")(function* listLabels(
        options: ListLabelsOptions
      ) {
        if (options.refresh === true) {
          return yield* refreshLabels(options.accountId);
        }

        const cached = yield* store.getLabels(options.accountId);

        if (cached.length > 0) {
          return cached;
        }

        return yield* refreshLabels(options.accountId);
      });

      const requireUserLabel = Effect.fn("Gmail.requireUserLabel")(
        function* requireUserLabel(accountId: AccountId, labelId: LabelId) {
          const label = (yield* store.getLabels(accountId)).find(
            (candidate) => candidate.id === labelId
          );

          if (label?.type !== "user") {
            return yield* new GmailValidationError({
              message: "Only user-created Gmail labels can be changed here",
            });
          }

          return label;
        }
      );

      const createLabel = Effect.fn("Gmail.createLabel")(function* createLabel(
        request: CreateLabelRequest
      ) {
        const label = yield* withAuthorization(
          request.accountId,
          "modify",
          (authorization) =>
            gateway.createLabel(authorization, request.name, request.color)
        );
        yield* store.upsertLabels(request.accountId, [label]);
        return label;
      });

      const deleteLabel = Effect.fn("Gmail.deleteLabel")(function* deleteLabel(
        request: DeleteLabelRequest
      ) {
        const label = yield* requireUserLabel(
          request.accountId,
          request.labelId
        );

        yield* withAuthorization(request.accountId, "modify", (authorization) =>
          gateway.deleteLabel(authorization, request.labelId)
        ).pipe(Effect.catchTag("GmailEntityNotFoundError", () => Effect.void));
        yield* store.deleteLabel(request.accountId, label);
      });

      const updateLabel = Effect.fn("Gmail.updateLabel")(function* updateLabel(
        request: UpdateLabelRequest
      ) {
        const previous = yield* requireUserLabel(
          request.accountId,
          request.labelId
        );
        const outcome = yield* withAuthorization(
          request.accountId,
          "modify",
          (authorization) =>
            gateway.patchLabel(
              authorization,
              request.labelId,
              request.name,
              request.color
            )
        ).pipe(
          Effect.map((label) => ({ label, type: "updated" }) as const),
          Effect.catchTag("GmailEntityNotFoundError", () =>
            Effect.succeed({ type: "removed" } as const)
          )
        );

        if (outcome.type === "removed") {
          yield* store.deleteLabel(request.accountId, previous);
          return outcome;
        }

        yield* store.updateLabel(request.accountId, previous, outcome.label);
        return outcome;
      });

      const resolveUnknownLabels = Effect.fn("Gmail.resolveUnknownLabels")(
        function* resolveUnknownLabels(
          accountId: AccountId,
          labelIds: readonly string[]
        ) {
          const cachedLabels = yield* store.getLabels(accountId);
          const knownLabelIds = new Set<string>(
            cachedLabels.map((label) => label.id)
          );
          const unknownLabelIds = [
            ...new Set(
              labelIds.filter((labelId) => !knownLabelIds.has(labelId))
            ),
          ];

          if (unknownLabelIds.length === 0) {
            return;
          }

          const labels = yield* withAuthorization(
            accountId,
            "read",
            (authorization) =>
              gateway.getLabels(
                authorization,
                unknownLabelIds.map((labelId) => LabelId.make(labelId))
              )
          );
          yield* store.upsertLabels(accountId, labels);
        }
      );

      /**
       * A thread whose MIME cannot be parsed is dropped rather than failing the
       * page: one malformed message must not be able to stall a full-account
       * index behind it. The summary still persists, so the thread stays
       * visible and readable — only its indexed bodies are missing.
       */
      const persistThreadPage = Effect.fn("Gmail.persistThreadPage")(
        function* persistThreadPage(
          accountId: AccountId,
          threads: readonly ThreadSummary[],
          details: readonly GatewayThread[]
        ) {
          yield* resolveUnknownLabels(
            accountId,
            threads.flatMap((thread) => thread.labelIds)
          );

          // Sequential on purpose: parsing is CPU-bound, and a page's worth of
          // threads racing each other would just contend for the same thread.
          // oxlint-disable-next-line unicorn/no-array-method-this-argument
          const parsed = yield* Effect.forEach(
            details,
            (detail) =>
              mime.parseThread(detail).pipe(Effect.orElseSucceed(() => null)),
            { concurrency: 1 }
          );

          yield* store.upsertThreadDetails(
            accountId,
            threads,
            parsed.filter((thread) => thread !== null)
          );
        }
      );

      const listThreads = Effect.fn("Gmail.listThreads")(function* listThreads(
        request: ListThreadsRequest
      ) {
        const resolved = yield* resolvePageRequest(request);
        const page = yield* withAuthorization(
          request.accountId,
          "read",
          (authorization) => gateway.listThreads(authorization, resolved)
        );

        yield* persistThreadPage(request.accountId, page.threads, page.details);
        if (page.historyId !== undefined) {
          yield* store.saveSyncCursor(request.accountId, page.historyId);
        }

        const nextCursor =
          page.nextPageToken === undefined
            ? undefined
            : encodeCursor({
                accountId: resolved.accountId,
                includeSpamTrash: resolved.includeSpamTrash,
                labelIds: resolved.labelIds,
                pageSize: resolved.pageSize,
                pageToken: page.nextPageToken,
                search: resolved.search,
                version: 1,
              });

        return {
          hasMore: nextCursor !== undefined,
          items: page.threads,
          nextCursor,
        } satisfies ThreadPage;
      });

      const getRemoteThread = Effect.fn("Gmail.getRemoteThread")(
        function* getRemoteThread(request: ThreadMutationRequest) {
          return yield* withAuthorization(
            request.accountId,
            "read",
            (authorization) =>
              gateway.getThread(authorization, request.threadId)
          ).pipe(
            Effect.catchTag("GmailEntityNotFoundError", (error) =>
              store.removeThreads(request.accountId, [request.threadId]).pipe(
                Effect.flatMap(() =>
                  withReconciledThread(error, {
                    outcome: "removed",
                    threadId: request.threadId,
                  })
                )
              )
            )
          );
        }
      );

      const getThread = Effect.fn("Gmail.getThread")(function* getThread(
        request: GetThreadRequest
      ) {
        if (request.refresh !== true) {
          const cached = yield* store.getThread(
            request.accountId,
            request.threadId
          );

          if (Option.isSome(cached)) {
            return cached.value;
          }
        }

        const raw = yield* getRemoteThread(request);
        yield* resolveUnknownLabels(request.accountId, raw.labelIds);
        const thread = yield* mime.parseThread(raw);
        yield* store.saveThread(request.accountId, thread);
        return thread;
      });

      const reconcileMissingThread = Effect.fn("Gmail.reconcileMissingThread")(
        function* reconcileMissingThread(request: ThreadMutationRequest) {
          const remoteThread = yield* withAuthorization(
            request.accountId,
            "read",
            (authorization) =>
              gateway.getThread(authorization, request.threadId)
          ).pipe(
            Effect.map(Option.some),
            Effect.catchTag(
              "GmailEntityNotFoundError",
              () => Effect.succeedNone
            )
          );

          if (Option.isSome(remoteThread)) {
            yield* resolveUnknownLabels(
              request.accountId,
              remoteThread.value.labelIds
            );
            const parsed = yield* mime.parseThread(remoteThread.value);
            yield* store.saveThread(request.accountId, parsed);
            return "refreshed" as const;
          }

          yield* store.removeThreads(request.accountId, [request.threadId]);
          return "removed" as const;
        }
      );

      const mutateThread = Effect.fn("Gmail.mutateThread")(
        function* mutateThread(
          request: ThreadMutationRequest,
          mutation: (
            authorization: GmailAuthorization
          ) => Effect.Effect<GatewayResult<void>, GmailGatewayError>
        ) {
          return yield* withAuthorization(
            request.accountId,
            "modify",
            mutation
          ).pipe(
            Effect.as("updated" as const),
            Effect.catchTag("GmailEntityNotFoundError", () =>
              reconcileMissingThread(request)
            )
          );
        }
      );

      const mutateThreadAndCache = Effect.fn("Gmail.mutateThreadAndCache")(
        function* mutateThreadAndCache(
          request: ThreadMutationRequest,
          mutation: (
            authorization: GmailAuthorization
          ) => Effect.Effect<GatewayResult<void>, GmailGatewayError>,
          updateCache: Effect.Effect<void, GmailError>
        ) {
          const outcome = yield* mutateThread(request, mutation);

          if (outcome === "updated") {
            yield* updateCache;
          }

          return outcome;
        }
      );

      const getAttachment = Effect.fn("Gmail.getAttachment")(
        function* getAttachment(request: GetAttachmentRequest) {
          return yield* withAuthorization(
            request.accountId,
            "read",
            (authorization) => gateway.getAttachment(authorization, request)
          ).pipe(
            Effect.catchTag("GmailEntityNotFoundError", (error) =>
              reconcileMissingThread({
                accountId: request.accountId,
                threadId: request.threadId,
              }).pipe(
                Effect.flatMap((outcome) =>
                  withReconciledThread(error, {
                    outcome,
                    threadId: request.threadId,
                  })
                )
              )
            )
          );
        }
      );

      const setThreadReadState = Effect.fn("Gmail.setThreadReadState")(
        function* setThreadReadState(
          request: ThreadMutationRequest,
          isRead: boolean
        ) {
          return yield* mutateThreadAndCache(
            request,
            (authorization) =>
              gateway.modifyThreadLabels(authorization, {
                addLabelIds: isRead ? [] : ["UNREAD"],
                removeLabelIds: isRead ? ["UNREAD"] : [],
                threadId: request.threadId,
              }),
            store.setThreadReadState(
              request.accountId,
              request.threadId,
              isRead
            )
          );
        }
      );

      const getBatchMessageIds = Effect.fn("Gmail.getBatchMessageIds")(
        function* getBatchMessageIds(request: BatchThreadMutationRequest) {
          const messageIds = [
            ...new Set(request.targets.flatMap((target) => target.messageIds)),
          ];

          if (messageIds.length === 0 || messageIds.length > 1000) {
            return yield* new GmailValidationError({
              message: "A Gmail batch must contain between 1 and 1000 messages",
            });
          }

          return messageIds;
        }
      );

      const batchModifyMessageLabels = Effect.fn(
        "Gmail.batchModifyMessageLabels"
      )(function* batchModifyMessageLabels(
        request: BatchThreadMutationRequest,
        addLabelIds: readonly string[],
        removeLabelIds: readonly string[]
      ) {
        const messageIds = yield* getBatchMessageIds(request);
        const targets = [
          ...new Map(
            request.targets.map((target) => [target.threadId, target])
          ).values(),
        ];

        return yield* withAuthorization(
          request.accountId,
          "modify",
          (authorization) =>
            gateway.batchModifyMessageLabels(authorization, {
              addLabelIds,
              messageIds,
              removeLabelIds,
            })
        ).pipe(
          Effect.as({ type: "updated" } as const),
          Effect.catchTag("GmailEntityNotFoundError", () =>
            // A batch 404 does not identify the missing message. Retrying the
            // 10-unit thread mutation avoids a 40-unit GET for valid threads;
            // mutateThread performs that GET only if this retry also returns 404.
            Effect.forEach(
              targets,
              (target) =>
                mutateThread(
                  {
                    accountId: request.accountId,
                    threadId: target.threadId,
                  },
                  (authorization) =>
                    gateway.modifyThreadLabels(authorization, {
                      addLabelIds,
                      removeLabelIds,
                      threadId: target.threadId,
                    })
                ).pipe(
                  Effect.map((outcome) => ({
                    outcome,
                    threadId: target.threadId,
                  }))
                ),
              { concurrency: ACCOUNT_REQUEST_CONCURRENCY }
            ).pipe(
              Effect.map(
                (results) => ({ results, type: "reconciled" }) as const
              )
            )
          )
        );
      });

      const batchSetThreadReadState = Effect.fn(
        "Gmail.batchSetThreadReadState"
      )(function* batchSetThreadReadState(
        request: BatchThreadMutationRequest,
        isRead: boolean
      ) {
        const outcome = yield* batchModifyMessageLabels(
          request,
          isRead ? [] : ["UNREAD"],
          isRead ? ["UNREAD"] : []
        );
        yield* Effect.all(
          getUpdatedThreadIds(request, outcome).map((threadId) =>
            store.setThreadReadState(request.accountId, threadId, isRead)
          )
        );
        return outcome;
      });

      const markThreadRead = Effect.fn("Gmail.markThreadRead")(
        function* markThreadRead(request: ThreadMutationRequest) {
          return yield* setThreadReadState(request, true);
        }
      );

      const markThreadUnread = Effect.fn("Gmail.markThreadUnread")(
        function* markThreadUnread(request: ThreadMutationRequest) {
          return yield* setThreadReadState(request, false);
        }
      );

      const moveThreadToInbox = Effect.fn("Gmail.moveThreadToInbox")(
        function* moveThreadToInbox(request: ThreadMutationRequest) {
          return yield* mutateThreadAndCache(
            request,
            (authorization) =>
              gateway.modifyThreadLabels(authorization, {
                addLabelIds: ["INBOX"],
                removeLabelIds: ["SPAM", "TRASH"],
                threadId: request.threadId,
              }),
            store.moveThreadToInbox(request.accountId, request.threadId)
          );
        }
      );

      const moveThreadToSpam = Effect.fn("Gmail.moveThreadToSpam")(
        function* moveThreadToSpam(request: ThreadMutationRequest) {
          return yield* mutateThreadAndCache(
            request,
            (authorization) =>
              gateway.modifyThreadLabels(authorization, {
                addLabelIds: ["SPAM"],
                removeLabelIds: ["INBOX", "TRASH"],
                threadId: request.threadId,
              }),
            store.moveThreadToSpam(request.accountId, request.threadId)
          );
        }
      );

      const setThreadLabel = Effect.fn("Gmail.setThreadLabel")(
        function* setThreadLabel(request: ThreadLabelMutationRequest) {
          const label = yield* requireUserLabel(
            request.accountId,
            request.labelId
          );

          return yield* mutateThreadAndCache(
            request,
            (authorization) =>
              gateway.modifyThreadLabels(authorization, {
                addLabelIds: request.applied ? [request.labelId] : [],
                removeLabelIds: request.applied ? [] : [request.labelId],
                threadId: request.threadId,
              }),
            store.setThreadLabel(
              request.accountId,
              request.threadId,
              label,
              request.applied
            )
          );
        }
      );

      const batchSetThreadLabel = Effect.fn("Gmail.batchSetThreadLabel")(
        function* batchSetThreadLabel(
          request: BatchThreadLabelMutationRequest
        ) {
          const label = yield* requireUserLabel(
            request.accountId,
            request.labelId
          );

          const outcome = yield* batchModifyMessageLabels(
            request,
            request.applied ? [request.labelId] : [],
            request.applied ? [] : [request.labelId]
          );
          yield* Effect.all(
            getUpdatedThreadIds(request, outcome).map((threadId) =>
              store.setThreadLabel(
                request.accountId,
                threadId,
                label,
                request.applied
              )
            )
          );
          return outcome;
        }
      );

      const trashThread = Effect.fn("Gmail.trashThread")(function* trashThread(
        request: ThreadMutationRequest
      ) {
        return yield* mutateThreadAndCache(
          request,
          (authorization) =>
            gateway.trashThread(authorization, request.threadId),
          store.removeThreads(request.accountId, [request.threadId])
        );
      });

      const batchTrashThreads = Effect.fn("Gmail.batchTrashThreads")(
        function* batchTrashThreads(request: BatchThreadMutationRequest) {
          const outcome = yield* batchModifyMessageLabels(
            request,
            ["TRASH"],
            ["INBOX", "SPAM"]
          );
          yield* store.removeThreads(
            request.accountId,
            getUpdatedThreadIds(request, outcome)
          );
          return outcome;
        }
      );

      const deleteThread = Effect.fn("Gmail.deleteThread")(
        function* deleteThread(request: ThreadMutationRequest) {
          return yield* mutateThreadAndCache(
            request,
            (authorization) =>
              gateway.deleteThread(authorization, request.threadId),
            store.removeThreads(request.accountId, [request.threadId])
          );
        }
      );

      const sendMessage = Effect.fn("Gmail.sendMessage")(function* sendMessage(
        input: SendMessageInput
      ) {
        const message = yield* mime.composeMessage(input);
        return yield* withAuthorization(
          input.accountId,
          "send",
          (authorization) => gateway.send(authorization, message)
        );
      });

      const findSentMessageByRfc822MessageId = Effect.fn(
        "Gmail.findSentMessageByRfc822MessageId"
      )(function* findSentMessageByRfc822MessageId(
        accountId: AccountId,
        rfc822MessageId: string
      ) {
        return yield* withAuthorization(accountId, "read", (authorization) =>
          gateway.findSentMessageByRfc822MessageId(
            authorization,
            rfc822MessageId
          )
        );
      });

      const forward = Effect.fn("Gmail.forward")(function* forward(
        input: ForwardInput
      ) {
        const rawThread = yield* getRemoteThread(input);
        const parsed = yield* mime.parseThread(rawThread);
        const forwarded =
          parsed.messages.find(
            (message) => message.id === input.forwardMessageId
          ) ?? parsed.messages.at(-1);
        const forwardedAttachments =
          forwarded === undefined
            ? []
            : yield* Effect.forEach(
                forwarded.attachments,
                (attachment) =>
                  getAttachment({
                    accountId: input.accountId,
                    attachmentId: attachment.attachmentId,
                    filename: attachment.filename,
                    mediaType: attachment.mediaType,
                    messageId: attachment.messageId,
                    threadId: input.threadId,
                  }).pipe(
                    Effect.map((loaded) => ({
                      ...loaded,
                      contentId: attachment.contentId,
                    }))
                  ),
                { concurrency: 3 }
              );
        const message = yield* mime.composeForward(
          {
            ...input,
            attachments: [
              ...forwardedAttachments,
              ...(input.attachments ?? []),
            ],
          },
          rawThread
        );

        return yield* withAuthorization(
          input.accountId,
          "send",
          (authorization) => gateway.send(authorization, message)
        );
      });

      const reply = Effect.fn("Gmail.reply")(function* reply(
        input: ReplyInput
      ) {
        const rawThread = yield* getRemoteThread(input);
        const message = yield* mime.composeReply(input, rawThread);
        return yield* withAuthorization(
          input.accountId,
          "send",
          (authorization) => gateway.send(authorization, message)
        );
      });

      const initialSync = Effect.fn("Gmail.initialSync")(function* initialSync(
        accountId: AccountId,
        type: "cursor-recovered" | "initial"
      ) {
        if (type === "initial") {
          yield* refreshLabels(accountId);
        }
        const page = yield* listThreads({
          accountId,
          labelIds: [LabelId.make("INBOX")],
          pageSize: 50,
        });
        const historyId = yield* withAuthorization(
          accountId,
          "read",
          (authorization) => gateway.getCurrentHistoryId(authorization)
        );
        yield* store.saveSyncCursor(accountId, historyId);
        return {
          addedMessageIds: [],
          changedThreadIds: page.items.map((thread) => thread.id),
          newThreadIds: [],
          type,
        } satisfies SyncResult;
      });

      const sync = Effect.fn("Gmail.sync")(function* sync(
        request: SyncRequest
      ) {
        const cursor = yield* store.getSyncCursor(request.accountId);

        if (Option.isNone(cursor)) {
          return yield* initialSync(request.accountId, "initial");
        }

        const applyHistory = Effect.fn("Gmail.applyHistory")(
          function* applyHistory(history: GatewayHistoryResult) {
            const existingThreadIds = new Set(
              yield* store.getExistingThreadIds(
                request.accountId,
                history.newThreadCandidateIds
              )
            );
            yield* persistThreadPage(
              request.accountId,
              history.threads,
              history.details
            );
            yield* store.removeThreads(
              request.accountId,
              history.removedThreadIds
            );
            yield* store.saveSyncCursor(request.accountId, history.historyId);

            return {
              addedMessageIds: history.addedMessageIds,
              changedThreadIds: [
                ...history.threads.map((thread) => thread.id),
                ...history.removedThreadIds,
              ],
              newThreadIds: history.newThreadCandidateIds.filter(
                (threadId) => !existingThreadIds.has(threadId)
              ),
              type: "partial",
            } satisfies SyncResult;
          }
        );

        return yield* withAuthorization(request.accountId, "read", (auth) =>
          gateway.listHistory(auth, cursor.value)
        ).pipe(
          Effect.flatMap(applyHistory),
          Effect.catchTag("GmailHistoryExpiredError", () =>
            initialSync(request.accountId, "cursor-recovered")
          )
        );
      });

      return Gmail.of({
        authorizeAccount,
        batchSetThreadLabel,
        batchSetThreadReadState,
        batchTrashThreads,
        createLabel,
        deleteLabel,
        deleteThread,
        disconnectAccount,
        findSentMessageByRfc822MessageId,
        forward,
        getAccount,
        getAttachment,
        getThread,
        listAccounts: store.listAccounts,
        listLabels,
        listThreads,
        markThreadRead,
        markThreadUnread,
        moveThreadToInbox,
        moveThreadToSpam,
        reply,
        sendMessage,
        setThreadLabel,
        sync,
        trashThread,
        updateLabel,
      });
    })
  );
}
