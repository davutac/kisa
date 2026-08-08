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
  InvalidAuthHandoffError,
} from "./errors";
import type {
  GatewayHistoryResult,
  GatewayResult,
  GatewayThread,
} from "./gateway";
import { GmailGateway } from "./gateway";
import { GmailMime } from "./mime";
import type {
  AccountId,
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
  ThreadMutationRequest,
  ThreadPage,
  ThreadSummary,
} from "./models";
import {
  GmailAccount,
  GmailCapabilities,
  GMAIL_MODIFY_SCOPE,
  GMAIL_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
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

const decodeAuthHandoff = Schema.decodeUnknownEffect(AuthHandoff);

const selectScopes = (scopes: readonly string[]): readonly GmailScope[] =>
  scopes.filter(
    (scope): scope is GmailScope =>
      scope === GMAIL_MODIFY_SCOPE ||
      scope === GMAIL_READONLY_SCOPE ||
      scope === GMAIL_SEND_SCOPE
  );

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

export interface GmailService {
  readonly authorizeAccount: (
    handoff: unknown
  ) => Effect.Effect<GmailAccount, GmailError>;
  readonly disconnectAccount: (
    options: DisconnectAccountOptions
  ) => Effect.Effect<void, GmailError>;
  readonly getAccount: (
    accountId: AccountId
  ) => Effect.Effect<GmailAccount, GmailError>;
  readonly getAttachment: (
    request: GetAttachmentRequest
  ) => Effect.Effect<GmailAttachment, GmailError>;
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
  ) => Effect.Effect<void, GmailError>;
  readonly markThreadUnread: (
    request: ThreadMutationRequest
  ) => Effect.Effect<void, GmailError>;
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
  ) => Effect.Effect<void, GmailError>;
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
          semaphore = Semaphore.makeUnsafe(4);
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
              ...(patch.accessToken === undefined
                ? {}
                : { accessToken: patch.accessToken }),
              ...(patch.expiresAt === undefined
                ? {}
                : { expiresAt: patch.expiresAt }),
              ...(patch.refreshToken === undefined
                ? {}
                : { refreshToken: patch.refreshToken }),
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
        function* authorizeAccount(input: unknown) {
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
          const canModify = scopes.includes(GMAIL_MODIFY_SCOPE);
          const account = new GmailAccount({
            avatarUrl: identity.avatarUrl,
            capabilities: new GmailCapabilities({
              modify: canModify,
              read: canModify || scopes.includes(GMAIL_READONLY_SCOPE),
              send: canModify || scopes.includes(GMAIL_SEND_SCOPE),
            }),
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

        const raw = yield* withAuthorization(
          request.accountId,
          "read",
          (authorization) => gateway.getThread(authorization, request.threadId)
        );
        const thread = yield* mime.parseThread(raw);
        yield* store.saveThread(request.accountId, thread);
        return thread;
      });

      const getAttachment = Effect.fn("Gmail.getAttachment")(
        function* getAttachment(request: GetAttachmentRequest) {
          return yield* withAuthorization(
            request.accountId,
            "read",
            (authorization) => gateway.getAttachment(authorization, request)
          );
        }
      );

      const setThreadReadState = Effect.fn("Gmail.setThreadReadState")(
        function* setThreadReadState(
          request: ThreadMutationRequest,
          isRead: boolean
        ) {
          yield* withAuthorization(
            request.accountId,
            "modify",
            (authorization) =>
              gateway.modifyThreadLabels(authorization, {
                addLabelIds: isRead ? [] : ["UNREAD"],
                removeLabelIds: isRead ? ["UNREAD"] : [],
                threadId: request.threadId,
              })
          );
          yield* store.setThreadReadState(
            request.accountId,
            request.threadId,
            isRead
          );
        }
      );

      const markThreadRead = Effect.fn("Gmail.markThreadRead")(
        function* markThreadRead(request: ThreadMutationRequest) {
          yield* setThreadReadState(request, true);
        }
      );

      const markThreadUnread = Effect.fn("Gmail.markThreadUnread")(
        function* markThreadUnread(request: ThreadMutationRequest) {
          yield* setThreadReadState(request, false);
        }
      );

      const trashThread = Effect.fn("Gmail.trashThread")(function* trashThread(
        request: ThreadMutationRequest
      ) {
        yield* withAuthorization(request.accountId, "modify", (authorization) =>
          gateway.trashThread(authorization, request.threadId)
        );
        yield* store.removeThreads(request.accountId, [request.threadId]);
      });

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

      const forward = Effect.fn("Gmail.forward")(function* forward(
        input: ForwardInput
      ) {
        const rawThread = yield* withAuthorization(
          input.accountId,
          "read",
          (authorization) => gateway.getThread(authorization, input.threadId)
        );
        const parsed = yield* mime.parseThread(rawThread);
        const forwarded =
          parsed.messages.find(
            (message) => message.id === input.forwardMessageId
          ) ?? parsed.messages.at(-1);
        const attachments =
          forwarded === undefined
            ? []
            : yield* Effect.forEach(
                forwarded.attachments,
                (attachment) =>
                  withAuthorization(input.accountId, "read", (authorization) =>
                    gateway.getAttachment(authorization, {
                      attachmentId: attachment.attachmentId,
                      filename: attachment.filename,
                      mediaType: attachment.mediaType,
                      messageId: attachment.messageId,
                    })
                  ).pipe(
                    Effect.map((loaded) => ({
                      ...loaded,
                      ...(attachment.contentId === undefined
                        ? {}
                        : { contentId: attachment.contentId }),
                    }))
                  ),
                { concurrency: 3 }
              );
        const message = yield* mime.composeForward(
          { ...input, attachments },
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
        const rawThread = yield* withAuthorization(
          input.accountId,
          "read",
          (authorization) => gateway.getThread(authorization, input.threadId)
        );
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
        yield* refreshLabels(accountId);
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
          changedThreadIds: page.items.map((thread) => thread.id),
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
            yield* refreshLabels(request.accountId);

            return {
              changedThreadIds: [
                ...history.threads.map((thread) => thread.id),
                ...history.removedThreadIds,
              ],
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
        disconnectAccount,
        forward,
        getAccount,
        getAttachment,
        getThread,
        listAccounts: store.listAccounts,
        listLabels,
        listThreads,
        markThreadRead,
        markThreadUnread,
        reply,
        sendMessage,
        sync,
        trashThread,
      });
    })
  );
}
