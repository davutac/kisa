// Oxlint does not recognize @effect/vitest's it.effect as a test declaration.
// oxlint-disable vitest/no-standalone-expect sonarjs/no-empty-test-file
import { assert, describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Redacted } from "effect";

import {
  GmailEntityNotFoundError,
  GmailHistoryExpiredError,
} from "../src/errors";
import type { GmailGatewayService } from "../src/gateway";
import { GmailGateway } from "../src/gateway";
import { Gmail } from "../src/gmail";
import type { GmailMimeService } from "../src/mime";
import { GmailMime } from "../src/mime";
import type { GmailAuthorization } from "../src/models";
import {
  AccountId,
  AttachmentId,
  AttachmentSummary,
  GmailCapabilities,
  GmailLabel,
  GmailMessage,
  GmailThread,
  GMAIL_FULL_ACCESS_SCOPE,
  HistoryId,
  LabelColor,
  LabelId,
  Mailbox,
  MessageId,
  SentMessage,
  ThreadId,
  ThreadSummary,
} from "../src/models";
import type { GmailStoreService } from "../src/store";
import { GmailStore } from "../src/store";

const INBOX_LABEL = new GmailLabel({
  id: LabelId.make("INBOX"),
  name: "INBOX",
  type: "system",
});
const UNKNOWN_LABEL_ID = LabelId.make("Label_99");
const USER_LABEL = new GmailLabel({
  id: LabelId.make("Label_1"),
  name: "Receipts",
  type: "user",
});

interface TestState {
  readonly attachmentCalls: string[];
  readonly authorizations: Map<AccountId, GmailAuthorization>;
  readonly batchLabelMutationCalls: {
    readonly accountId: AccountId;
    readonly addLabelIds: readonly string[];
    readonly messageIds: readonly MessageId[];
    readonly removeLabelIds: readonly string[];
  }[];
  readonly listThreadCalls: {
    readonly accountId: AccountId;
    readonly pageToken?: string;
  }[];
  readonly labelGetCalls: LabelId[];
  readonly labelCreateCalls: {
    readonly accountId: AccountId;
    readonly color?: LabelColor;
    readonly name: string;
  }[];
  readonly labelDeleteCalls: {
    readonly accountId: AccountId;
    readonly labelId: LabelId;
  }[];
  readonly labelUpdateCalls: {
    readonly accountId: AccountId;
    readonly color?: LabelColor;
    readonly labelId: LabelId;
    readonly name: string;
  }[];
  readonly labelMutationCalls: {
    readonly addLabelIds: readonly string[];
    readonly removeLabelIds: readonly string[];
    readonly threadId: ThreadId;
  }[];
  labelListCalls: number;
  labels: readonly GmailLabel[];
  readonly mutationCalls: {
    readonly accountId: AccountId;
    readonly operation: "delete" | "labels" | "trash";
    readonly threadId: ThreadId;
    readonly unread?: boolean;
  }[];
  readonly readStateChanges: {
    readonly accountId: AccountId;
    readonly isRead: boolean;
    readonly threadId: ThreadId;
  }[];
  readonly spamStateChanges: {
    readonly accountId: AccountId;
    readonly threadId: ThreadId;
  }[];
  readonly threadLabelChanges: {
    readonly accountId: AccountId;
    readonly applied: boolean;
    readonly labelId: LabelId;
    readonly threadId: ThreadId;
  }[];
  readonly indexedThreadIds: ThreadId[];
  readonly removedThreads: ThreadId[];
  readonly savedThreadIds: ThreadId[];
  forwardAttachmentContentIds: readonly (string | undefined)[];
  readonly getThreadCalls: {
    readonly accountId: AccountId;
    readonly threadId: ThreadId;
  }[];
  sendCalls: number;
}

interface TestLayerOptions {
  readonly attachmentNotFound?: boolean;
  readonly batchMutationNotFound?: boolean;
  readonly cachedLabels?: readonly GmailLabel[];
  readonly historyAddedMessageIds?: readonly MessageId[];
  readonly historyExpired?: boolean;
  readonly historyThreads?: readonly ThreadSummary[];
  readonly labelMutationNotFound?: boolean;
  readonly syncCursor?: HistoryId;
  readonly threadGetNotFound?: boolean;
  readonly threadMutationNotFound?: boolean;
  readonly threadLabelIds?: readonly LabelId[];
}

const missingEntity = (
  accountId: AccountId,
  resource: GmailEntityNotFoundError["resource"]
): GmailEntityNotFoundError =>
  new GmailEntityNotFoundError({
    accountId,
    message: "Requested entity was not found.",
    resource,
  });

const createTestLayer = (options: TestLayerOptions = {}) => {
  const state: TestState = {
    attachmentCalls: [],
    authorizations: new Map(),
    batchLabelMutationCalls: [],
    forwardAttachmentContentIds: [],
    getThreadCalls: [],
    indexedThreadIds: [],
    labelCreateCalls: [],
    labelDeleteCalls: [],
    labelGetCalls: [],
    labelListCalls: 0,
    labelMutationCalls: [],
    labelUpdateCalls: [],
    labels: options.cachedLabels ?? [],
    listThreadCalls: [],
    mutationCalls: [],
    readStateChanges: [],
    removedThreads: [],
    savedThreadIds: [],
    sendCalls: 0,
    spamStateChanges: [],
    threadLabelChanges: [],
  };

  const store: GmailStoreService = {
    clearAccount: (accountId) =>
      Effect.sync(() => {
        state.authorizations.delete(accountId);
      }),
    deleteLabel: (_accountId, label) =>
      Effect.sync(() => {
        state.labels = state.labels.filter(
          (candidate) => candidate.id !== label.id
        );
      }),
    getAuthorization: (accountId) =>
      Effect.sync(() =>
        Option.fromNullishOr(state.authorizations.get(accountId))
      ),
    getLabels: () => Effect.succeed(state.labels),
    getSyncCursor: () =>
      Effect.succeed(Option.fromNullishOr(options.syncCursor)),
    getThread: () => Effect.succeed(Option.none()),
    listAccounts: Effect.sync(() =>
      [...state.authorizations.values()].map(({ account }) => account)
    ),
    markThreadNotSpam: (accountId, threadId) =>
      Effect.sync(() => {
        state.spamStateChanges.push({ accountId, threadId });
      }),
    removeThreads: (_accountId, threadIds) =>
      Effect.sync(() => {
        state.removedThreads.push(...threadIds);
      }),
    replaceLabels: (_accountId, labels) =>
      Effect.sync(() => {
        state.labels = labels;
      }),
    saveAuthorization: (authorization) =>
      Effect.sync(() => {
        state.authorizations.set(authorization.account.id, authorization);
      }),
    saveSyncCursor: () => Effect.void,
    saveThread: (_accountId, thread) =>
      Effect.sync(() => {
        state.savedThreadIds.push(thread.id);
      }),
    setThreadLabel: (accountId, threadId, label, applied) =>
      Effect.sync(() => {
        state.threadLabelChanges.push({
          accountId,
          applied,
          labelId: label.id,
          threadId,
        });
      }),
    setThreadReadState: (accountId, threadId, isRead) =>
      Effect.sync(() => {
        state.readStateChanges.push({ accountId, isRead, threadId });
      }),
    updateCredentials: (accountId, patch) =>
      Effect.sync(() => {
        const current = state.authorizations.get(accountId);

        if (current !== undefined) {
          state.authorizations.set(accountId, {
            ...current,
            credentials: {
              ...current.credentials,
              ...patch,
            },
          });
        }
      }),
    updateLabel: (_accountId, previous, updated) =>
      Effect.sync(() => {
        state.labels = state.labels.map((candidate) =>
          candidate.id === previous.id ? updated : candidate
        );
      }),
    upsertLabels: (_accountId, labels) =>
      Effect.sync(() => {
        const next = new Map(state.labels.map((label) => [label.id, label]));

        for (const label of labels) {
          next.set(label.id, label);
        }

        state.labels = [...next.values()];
      }),
    upsertThreadDetails: (_accountId, _threads, details) =>
      Effect.sync(() => {
        state.indexedThreadIds.push(...details.map((thread) => thread.id));
      }),
  };

  const gateway: GmailGatewayService = {
    batchModifyMessageLabels: (authorization, request) =>
      options.batchMutationNotFound === true
        ? Effect.fail(missingEntity(authorization.account.id, "message"))
        : Effect.sync(() => {
            state.batchLabelMutationCalls.push({
              accountId: authorization.account.id,
              addLabelIds: request.addLabelIds,
              messageIds: request.messageIds,
              removeLabelIds: request.removeLabelIds,
            });
            return { value: undefined };
          }),
    createLabel: (authorization, name, color) =>
      Effect.sync(() => {
        state.labelCreateCalls.push({
          accountId: authorization.account.id,
          color,
          name,
        });
        return {
          value: new GmailLabel({
            color,
            id: LabelId.make("Label_created"),
            name,
            type: "user",
          }),
        };
      }),
    deleteLabel: (authorization, labelId) =>
      options.labelMutationNotFound === true
        ? Effect.fail(missingEntity(authorization.account.id, "label"))
        : Effect.sync(() => {
            state.labelDeleteCalls.push({
              accountId: authorization.account.id,
              labelId,
            });
            return { value: undefined };
          }),
    deleteThread: (authorization, threadId) =>
      options.threadMutationNotFound === true
        ? Effect.fail(missingEntity(authorization.account.id, "thread"))
        : Effect.sync(() => {
            state.mutationCalls.push({
              accountId: authorization.account.id,
              operation: "delete",
              threadId,
            });
            return { value: undefined };
          }),
    getAttachment: (_authorization, request) =>
      options.attachmentNotFound === true
        ? Effect.fail(missingEntity(_authorization.account.id, "attachment"))
        : Effect.sync(() => {
            state.attachmentCalls.push(request.attachmentId);
            return {
              value: {
                bytes: new Uint8Array([1, 2, 3]),
                filename: request.filename,
                mediaType: request.mediaType,
              },
            };
          }),
    getCurrentHistoryId: () =>
      Effect.succeed({ value: HistoryId.make("history-current") }),
    getLabels: (_authorization, labelIds) =>
      Effect.sync(() => {
        state.labelGetCalls.push(...labelIds);
        return {
          value: labelIds.map(
            (labelId) =>
              new GmailLabel({
                id: labelId,
                name: labelId === UNKNOWN_LABEL_ID ? "New label" : labelId,
                type: labelId.startsWith("Label_") ? "user" : "system",
              })
          ),
        };
      }),
    getMailboxTotals: () => Effect.die("unused"),
    getThread: (authorization, threadId) => {
      state.getThreadCalls.push({
        accountId: authorization.account.id,
        threadId,
      });

      return options.threadGetNotFound === true
        ? Effect.fail(missingEntity(authorization.account.id, "thread"))
        : Effect.succeed({
            value: {
              historyId: HistoryId.make("history-1"),
              id: threadId,
              labelIds: ["INBOX"],
              messages: [],
            },
          });
    },
    identifyAccount: (credentials) => {
      const token = Redacted.value(credentials.accessToken);
      const suffix = token.at(-1) ?? "a";
      return Effect.succeed({
        email: `${suffix}@example.com`,
        id: AccountId.make(`account-${suffix}`),
      });
    },
    listHistory: (authorization) =>
      options.historyExpired === true
        ? Effect.fail(
            new GmailHistoryExpiredError({
              accountId: authorization.account.id,
              message: "History expired",
            })
          )
        : Effect.succeed({
            value: {
              addedMessageIds: options.historyAddedMessageIds ?? [],
              details: [],
              historyId: HistoryId.make("history-next"),
              removedThreadIds: [],
              threads: options.historyThreads ?? [],
            },
          }),
    listLabels: () =>
      Effect.sync(() => {
        state.labelListCalls += 1;
        return {
          value: [INBOX_LABEL],
        };
      }),
    listThreads: (authorization, request) => {
      state.listThreadCalls.push({
        accountId: authorization.account.id,
        pageToken: request.pageToken,
      });
      const id = ThreadId.make(
        `${authorization.account.id}-${request.pageToken ?? "first"}`
      );
      return Effect.succeed({
        value: {
          details: [],
          historyId: HistoryId.make("history-1"),
          nextPageToken: request.pageToken === undefined ? "page-2" : undefined,
          threads: [
            new ThreadSummary({
              attachments: [],
              hasAttachments: false,
              hasUnread: true,
              id,
              labelIds: options.threadLabelIds ?? [LabelId.make("INBOX")],
              latestAt: "2026-08-06T12:00:00.000Z",
              latestMessageId: MessageId.make(`${id}-message`),
              messageCount: 1,
              participants: [],
              snippet: "Hello",
              subject: "Subject",
            }),
          ],
        },
      });
    },
    modifyThreadLabels: (authorization, request) =>
      options.threadMutationNotFound === true
        ? Effect.fail(missingEntity(authorization.account.id, "thread"))
        : Effect.sync(() => {
            state.labelMutationCalls.push({
              addLabelIds: request.addLabelIds,
              removeLabelIds: request.removeLabelIds,
              threadId: request.threadId,
            });
            state.mutationCalls.push({
              accountId: authorization.account.id,
              operation: "labels",
              threadId: request.threadId,
              unread: request.addLabelIds.includes("UNREAD"),
            });
            return { value: undefined };
          }),
    patchLabel: (authorization, labelId, name, color) =>
      options.labelMutationNotFound === true
        ? Effect.fail(missingEntity(authorization.account.id, "label"))
        : Effect.sync(() => {
            state.labelUpdateCalls.push({
              accountId: authorization.account.id,
              color,
              labelId,
              name,
            });
            return {
              value: new GmailLabel({
                color,
                id: labelId,
                name,
                type: "user",
              }),
            };
          }),
    revoke: () => Effect.void,
    send: () =>
      Effect.sync(() => {
        state.sendCalls += 1;
        return {
          value: new SentMessage({
            id: MessageId.make("sent-message"),
            threadId: ThreadId.make("sent-thread"),
          }),
        };
      }),
    trashThread: (authorization, threadId) =>
      options.threadMutationNotFound === true
        ? Effect.fail(missingEntity(authorization.account.id, "thread"))
        : Effect.sync(() => {
            state.mutationCalls.push({
              accountId: authorization.account.id,
              operation: "trash",
              threadId,
            });
            return { value: undefined };
          }),
  };

  const mime: GmailMimeService = {
    composeForward: (input) =>
      Effect.sync(() => {
        state.forwardAttachmentContentIds =
          input.attachments?.map((attachment) => attachment.contentId) ?? [];
        return { raw: "forwarded" };
      }),
    composeMessage: () => Effect.die("unused"),
    composeReply: () => Effect.die("unused"),
    parseThread: (rawThread) =>
      Effect.succeed(
        new GmailThread({
          historyId: HistoryId.make("history-1"),
          id: rawThread.id,
          labelIds: [LabelId.make("INBOX")],
          messages: [
            new GmailMessage({
              attachments: [
                new AttachmentSummary({
                  attachmentId: AttachmentId.make("attachment-1"),
                  contentId: "logo@example.com",
                  filename: "logo.png",
                  mediaType: "image/png",
                  messageId: MessageId.make("message-1"),
                  size: 3,
                }),
              ],
              bcc: [],
              body: { text: "Hello", type: "text" },
              cc: [],
              from: new Mailbox({ address: "sender@example.com" }),
              id: MessageId.make("message-1"),
              labelIds: [LabelId.make("INBOX")],
              sentAt: "1700000000000",
              subject: "Subject",
              threadId: rawThread.id,
              to: [new Mailbox({ address: "me@example.com" })],
            }),
          ],
        })
      ),
  };

  const dependencies = Layer.mergeAll(
    Layer.succeed(GmailStore, store),
    Layer.succeed(GmailGateway, gateway),
    Layer.succeed(GmailMime, mime)
  );

  return {
    layer: Gmail.layerWithoutDependencies.pipe(Layer.provide(dependencies)),
    state,
  };
};

const authHandoff = (accessToken: string, refreshToken?: string) => ({
  accessToken,
  refreshToken,
  scopes: [GMAIL_FULL_ACCESS_SCOPE],
});

const threadSummaryWithLabels = (labelIds: readonly LabelId[]): ThreadSummary =>
  new ThreadSummary({
    attachments: [],
    hasAttachments: false,
    hasUnread: false,
    id: ThreadId.make("thread-with-labels"),
    labelIds,
    latestAt: "2026-08-06T12:00:00.000Z",
    latestMessageId: MessageId.make("message-with-labels"),
    messageCount: 1,
    participants: [],
    snippet: "",
    subject: "Labels",
  });

describe(Gmail, () => {
  it.effect("preserves a refresh token when reconnecting an account", () => {
    const { layer, state } = createTestLayer();

    return Effect.gen(function* preservesRefreshToken() {
      const gmail = yield* Gmail;
      const account = yield* gmail.authorizeAccount(
        authHandoff("access-a", "refresh-a")
      );
      yield* gmail.authorizeAccount(authHandoff("new-access-a"));

      const authorization = state.authorizations.get(account.id);
      assert.isDefined(authorization);
      if (authorization === undefined) {
        return;
      }

      const { refreshToken } = authorization.credentials;
      assert.isDefined(refreshToken);
      if (refreshToken === undefined) {
        return;
      }

      expect(Redacted.value(refreshToken)).toBe("refresh-a");
      expect(Redacted.value(authorization.credentials.accessToken)).toBe(
        "new-access-a"
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("keeps accounts separate and binds cursors to one account", () => {
    const { layer, state } = createTestLayer();

    return Effect.gen(function* isolatesAccountCursors() {
      const gmail = yield* Gmail;
      const accountA = yield* gmail.authorizeAccount(authHandoff("access-a"));
      const accountB = yield* gmail.authorizeAccount(authHandoff("access-b"));
      const firstPage = yield* gmail.listThreads({
        accountId: accountA.id,
        labelIds: [LabelId.make("INBOX")],
        pageSize: 25,
      });

      expect(firstPage.hasMore).toBeTruthy();
      assert.isDefined(firstPage.nextCursor);
      if (firstPage.nextCursor === undefined) {
        return;
      }

      const cursorError = yield* Effect.flip(
        gmail.listThreads({
          accountId: accountB.id,
          cursor: firstPage.nextCursor,
        })
      );

      expect(cursorError._tag).toBe("GmailValidationError");

      const secondPage = yield* gmail.listThreads({
        accountId: accountA.id,
        cursor: firstPage.nextCursor,
      });

      expect(secondPage.hasMore).toBeFalsy();
      expect(state.listThreadCalls).toStrictEqual([
        { accountId: accountA.id, pageToken: undefined },
        { accountId: accountA.id, pageToken: "page-2" },
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("marks threads read or unread and moves them to trash", () => {
    const { layer, state } = createTestLayer();

    return Effect.gen(function* mutatesThreads() {
      const gmail = yield* Gmail;
      const account = yield* gmail.authorizeAccount({
        accessToken: "access-a",
        scopes: [GMAIL_FULL_ACCESS_SCOPE],
      });
      const request = {
        accountId: account.id,
        threadId: ThreadId.make("thread-1"),
      };

      expect(account.capabilities).toStrictEqual(
        new GmailCapabilities({ modify: true, read: true, send: true })
      );

      yield* gmail.markThreadRead(request);
      yield* gmail.markThreadUnread(request);
      yield* gmail.trashThread(request);

      expect(state.mutationCalls).toStrictEqual([
        {
          accountId: account.id,
          operation: "labels",
          threadId: request.threadId,
          unread: false,
        },
        {
          accountId: account.id,
          operation: "labels",
          threadId: request.threadId,
          unread: true,
        },
        {
          accountId: account.id,
          operation: "trash",
          threadId: request.threadId,
        },
      ]);
      expect(state.readStateChanges).toStrictEqual([
        { accountId: account.id, isRead: true, threadId: request.threadId },
        { accountId: account.id, isRead: false, threadId: request.threadId },
      ]);
      expect(state.removedThreads).toStrictEqual([request.threadId]);
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "evicts stale cached threads after Gmail confirms they are missing",
    () => {
      const { layer, state } = createTestLayer({
        cachedLabels: [USER_LABEL],
        threadGetNotFound: true,
        threadMutationNotFound: true,
      });

      return Effect.gen(function* reconcilesMissingThreads() {
        const gmail = yield* Gmail;
        const account = yield* gmail.authorizeAccount({
          accessToken: "access-a",
          scopes: [GMAIL_FULL_ACCESS_SCOPE],
        });
        const request = {
          accountId: account.id,
          threadId: ThreadId.make("stale-thread"),
        };

        yield* gmail.markThreadRead(request);
        yield* gmail.markThreadUnread(request);
        yield* gmail.markThreadNotSpam(request);
        yield* gmail.setThreadLabel({
          ...request,
          applied: true,
          labelId: USER_LABEL.id,
        });
        yield* gmail.trashThread(request);
        yield* gmail.deleteThread(request);

        expect(state.getThreadCalls).toStrictEqual(
          Array.from({ length: 6 }, () => ({
            accountId: account.id,
            threadId: request.threadId,
          }))
        );
        expect(state.removedThreads).toStrictEqual(
          Array.from({ length: 6 }, () => request.threadId)
        );
        expect(state.mutationCalls).toStrictEqual([]);
      }).pipe(Effect.provide(layer));
    }
  );

  it.effect("reconciles the parent thread after an attachment 404", () => {
    const { layer, state } = createTestLayer({
      attachmentNotFound: true,
      threadGetNotFound: true,
    });

    return Effect.gen(function* reconcilesMissingAttachment() {
      const gmail = yield* Gmail;
      const account = yield* gmail.authorizeAccount(authHandoff("access-a"));
      const threadId = ThreadId.make("stale-thread");

      const error = yield* gmail
        .getAttachment({
          accountId: account.id,
          attachmentId: AttachmentId.make("stale-attachment"),
          filename: "stale.pdf",
          mediaType: "application/pdf",
          messageId: MessageId.make("stale-message"),
          threadId,
        })
        .pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "GmailEntityNotFoundError",
        reconciledThread: { outcome: "removed", threadId },
        resource: "attachment",
      });
      expect(state.removedThreads).toStrictEqual([threadId]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("evicts a thread when its direct fetch returns 404", () => {
    const { layer, state } = createTestLayer({ threadGetNotFound: true });

    return Effect.gen(function* reconcilesMissingThreadFetch() {
      const gmail = yield* Gmail;
      const account = yield* gmail.authorizeAccount(authHandoff("access-a"));
      const threadId = ThreadId.make("stale-thread");

      const error = yield* gmail
        .getThread({ accountId: account.id, refresh: true, threadId })
        .pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "GmailEntityNotFoundError",
        reconciledThread: { outcome: "removed", threadId },
        resource: "thread",
      });
      expect(state.removedThreads).toStrictEqual([threadId]);
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "preserves the cache when the thread still exists after a mutation 404",
    () => {
      const { layer, state } = createTestLayer({
        cachedLabels: [USER_LABEL],
        threadMutationNotFound: true,
      });

      return Effect.gen(function* preservesExistingThread() {
        const gmail = yield* Gmail;
        const account = yield* gmail.authorizeAccount({
          accessToken: "access-a",
          scopes: [GMAIL_FULL_ACCESS_SCOPE],
        });
        const request = {
          accountId: account.id,
          applied: true,
          labelId: USER_LABEL.id,
          threadId: ThreadId.make("existing-thread"),
        };

        const outcome = yield* gmail.setThreadLabel(request);

        expect(outcome).toBe("refreshed");
        expect(state.getThreadCalls).toStrictEqual([
          { accountId: account.id, threadId: request.threadId },
        ]);
        expect(state.removedThreads).toStrictEqual([]);
        expect(state.savedThreadIds).toStrictEqual([request.threadId]);
        expect(state.threadLabelChanges).toStrictEqual([]);
      }).pipe(Effect.provide(layer));
    }
  );

  it.effect(
    "batches message mutations while updating each cached thread",
    () => {
      const { layer, state } = createTestLayer({ cachedLabels: [USER_LABEL] });

      return Effect.gen(function* batchesMessageMutations() {
        const gmail = yield* Gmail;
        const account = yield* gmail.authorizeAccount(authHandoff("access-a"));
        const targets = [
          {
            messageIds: [MessageId.make("message-1")],
            threadId: ThreadId.make("thread-1"),
          },
          {
            messageIds: [
              MessageId.make("message-2"),
              MessageId.make("message-3"),
            ],
            threadId: ThreadId.make("thread-2"),
          },
        ];

        yield* gmail.batchSetThreadReadState(
          { accountId: account.id, targets },
          true
        );
        yield* gmail.batchSetThreadLabel({
          accountId: account.id,
          applied: true,
          labelId: USER_LABEL.id,
          targets,
        });
        yield* gmail.batchTrashThreads({ accountId: account.id, targets });

        expect(state.batchLabelMutationCalls).toStrictEqual([
          {
            accountId: account.id,
            addLabelIds: [],
            messageIds: ["message-1", "message-2", "message-3"],
            removeLabelIds: ["UNREAD"],
          },
          {
            accountId: account.id,
            addLabelIds: ["Label_1"],
            messageIds: ["message-1", "message-2", "message-3"],
            removeLabelIds: [],
          },
          {
            accountId: account.id,
            addLabelIds: ["TRASH"],
            messageIds: ["message-1", "message-2", "message-3"],
            removeLabelIds: ["INBOX", "SPAM"],
          },
        ]);
        expect(state.readStateChanges).toStrictEqual([
          { accountId: account.id, isRead: true, threadId: "thread-1" },
          { accountId: account.id, isRead: true, threadId: "thread-2" },
        ]);
        expect(state.threadLabelChanges).toStrictEqual([
          {
            accountId: account.id,
            applied: true,
            labelId: "Label_1",
            threadId: "thread-1",
          },
          {
            accountId: account.id,
            applied: true,
            labelId: "Label_1",
            threadId: "thread-2",
          },
        ]);
        expect(state.removedThreads).toStrictEqual(["thread-1", "thread-2"]);
      }).pipe(Effect.provide(layer));
    }
  );

  it.effect("falls back to per-thread mutations after a batch 404", () => {
    const { layer, state } = createTestLayer({ batchMutationNotFound: true });

    return Effect.gen(function* retriesBatchTargets() {
      const gmail = yield* Gmail;
      const account = yield* gmail.authorizeAccount(authHandoff("access-a"));
      const first = {
        messageIds: [MessageId.make("thread-1-message")],
        threadId: ThreadId.make("thread-1"),
      };
      const second = {
        messageIds: [MessageId.make("thread-2-message")],
        threadId: ThreadId.make("thread-2"),
      };
      const uniqueTargets = [first, second];
      const targets = [first, first, second];

      const outcome = yield* gmail.batchSetThreadReadState(
        { accountId: account.id, targets },
        true
      );

      expect(outcome).toStrictEqual({
        results: uniqueTargets.map((target) => ({
          outcome: "updated",
          threadId: target.threadId,
        })),
        type: "reconciled",
      });
      expect(state.getThreadCalls).toStrictEqual([]);
      expect(state.readStateChanges).toStrictEqual(
        uniqueTargets.map((target) => ({
          accountId: account.id,
          isRead: true,
          threadId: target.threadId,
        }))
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("reconciles targets missing during batch fallback", () => {
    const { layer, state } = createTestLayer({
      batchMutationNotFound: true,
      threadGetNotFound: true,
      threadMutationNotFound: true,
    });

    return Effect.gen(function* reconcilesMissingBatchTargets() {
      const gmail = yield* Gmail;
      const account = yield* gmail.authorizeAccount(authHandoff("access-a"));
      const targets = ["thread-1", "thread-2"].map((threadId) => ({
        messageIds: [MessageId.make(`${threadId}-message`)],
        threadId: ThreadId.make(threadId),
      }));

      const outcome = yield* gmail.batchSetThreadReadState(
        { accountId: account.id, targets },
        true
      );

      expect(outcome).toStrictEqual({
        results: targets.map((target) => ({
          outcome: "removed",
          threadId: target.threadId,
        })),
        type: "reconciled",
      });
      expect(state.removedThreads).toStrictEqual(
        targets.map((target) => target.threadId)
      );
      expect(state.readStateChanges).toStrictEqual([]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("permanently deletes threads only with full Gmail access", () => {
    const { layer, state } = createTestLayer();

    return Effect.gen(function* permanentlyDeletesThreads() {
      const gmail = yield* Gmail;
      const noScopeAccount = yield* gmail.authorizeAccount({
        accessToken: "access-a",
        scopes: [],
      });
      const request = {
        accountId: noScopeAccount.id,
        threadId: ThreadId.make("thread-1"),
      };
      const permissionError = yield* gmail
        .deleteThread(request)
        .pipe(Effect.flip);

      expect(permissionError).toMatchObject({
        _tag: "GmailPermissionError",
        capability: "modify",
      });

      const fullAccessAccount = yield* gmail.authorizeAccount({
        accessToken: "access-a",
        scopes: [GMAIL_FULL_ACCESS_SCOPE],
      });

      yield* gmail.deleteThread(request);

      expect(state.mutationCalls).toStrictEqual([
        {
          accountId: fullAccessAccount.id,
          operation: "delete",
          threadId: request.threadId,
        },
      ]);
      expect(state.removedThreads).toStrictEqual([request.threadId]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("moves a thread from Spam to Inbox", () => {
    const { layer, state } = createTestLayer();

    return Effect.gen(function* recoversSpam() {
      const gmail = yield* Gmail;
      const account = yield* gmail.authorizeAccount({
        accessToken: "access-a",
        scopes: [GMAIL_FULL_ACCESS_SCOPE],
      });
      const request = {
        accountId: account.id,
        threadId: ThreadId.make("thread-1"),
      };

      yield* gmail.markThreadNotSpam(request);

      expect(state.labelMutationCalls).toStrictEqual([
        {
          addLabelIds: ["INBOX"],
          removeLabelIds: ["SPAM"],
          threadId: request.threadId,
        },
      ]);
      expect(state.spamStateChanges).toStrictEqual([
        { accountId: account.id, threadId: request.threadId },
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("adds and removes user labels from threads", () => {
    const { layer, state } = createTestLayer({ cachedLabels: [USER_LABEL] });

    return Effect.gen(function* changesUserLabel() {
      const gmail = yield* Gmail;
      const account = yield* gmail.authorizeAccount({
        accessToken: "access-a",
        scopes: [GMAIL_FULL_ACCESS_SCOPE],
      });
      const request = {
        accountId: account.id,
        labelId: USER_LABEL.id,
        threadId: ThreadId.make("thread-1"),
      };

      yield* gmail.setThreadLabel({ ...request, applied: true });
      yield* gmail.setThreadLabel({ ...request, applied: false });

      expect(state.labelMutationCalls).toStrictEqual([
        {
          addLabelIds: ["Label_1"],
          removeLabelIds: [],
          threadId: request.threadId,
        },
        {
          addLabelIds: [],
          removeLabelIds: ["Label_1"],
          threadId: request.threadId,
        },
      ]);
      expect(state.threadLabelChanges).toStrictEqual([
        {
          accountId: account.id,
          applied: true,
          labelId: "Label_1",
          threadId: request.threadId,
        },
        {
          accountId: account.id,
          applied: false,
          labelId: "Label_1",
          threadId: request.threadId,
        },
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("creates, updates, and deletes user labels", () => {
    const { layer, state } = createTestLayer({
      cachedLabels: [INBOX_LABEL, USER_LABEL],
    });

    return Effect.gen(function* createsAndDeletesLabels() {
      const gmail = yield* Gmail;
      const account = yield* gmail.authorizeAccount({
        accessToken: "access-a",
        scopes: [GMAIL_FULL_ACCESS_SCOPE],
      });
      const color = new LabelColor({
        background: "#4a86e8",
        text: "#ffffff",
      });
      const created = yield* gmail.createLabel({
        accountId: account.id,
        color,
        name: "Projects/Kisa",
      });

      expect(created).toStrictEqual(
        new GmailLabel({
          color,
          id: LabelId.make("Label_created"),
          name: "Projects/Kisa",
          type: "user",
        })
      );

      const updated = yield* gmail.updateLabel({
        accountId: account.id,
        color,
        labelId: USER_LABEL.id,
        name: "Invoices",
      });

      expect(updated).toStrictEqual({
        label: new GmailLabel({
          color,
          id: USER_LABEL.id,
          name: "Invoices",
          type: "user",
        }),
        type: "updated",
      });

      yield* gmail.deleteLabel({
        accountId: account.id,
        labelId: USER_LABEL.id,
      });

      expect({
        createCalls: state.labelCreateCalls,
        deleteCalls: state.labelDeleteCalls,
        labels: state.labels,
        updateCalls: state.labelUpdateCalls,
      }).toStrictEqual({
        createCalls: [{ accountId: account.id, color, name: "Projects/Kisa" }],
        deleteCalls: [{ accountId: account.id, labelId: USER_LABEL.id }],
        labels: [INBOX_LABEL, created],
        updateCalls: [
          {
            accountId: account.id,
            color,
            labelId: USER_LABEL.id,
            name: "Invoices",
          },
        ],
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("removes a stale cached label when Gmail returns 404", () => {
    const { layer, state } = createTestLayer({
      cachedLabels: [USER_LABEL],
      labelMutationNotFound: true,
    });

    return Effect.gen(function* reconcilesMissingLabel() {
      const gmail = yield* Gmail;
      const account = yield* gmail.authorizeAccount(authHandoff("access-a"));

      yield* gmail.deleteLabel({
        accountId: account.id,
        labelId: USER_LABEL.id,
      });

      expect(state.labels).toStrictEqual([]);
      expect(state.labelDeleteCalls).toStrictEqual([]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("refreshes the catalog when a label update returns 404", () => {
    const { layer, state } = createTestLayer({
      cachedLabels: [USER_LABEL],
      labelMutationNotFound: true,
    });

    return Effect.gen(function* reconcilesMissingLabelUpdate() {
      const gmail = yield* Gmail;
      const account = yield* gmail.authorizeAccount(authHandoff("access-a"));

      const outcome = yield* gmail.updateLabel({
        accountId: account.id,
        labelId: USER_LABEL.id,
        name: "Invoices",
      });

      expect(outcome).toStrictEqual({ type: "removed" });
      expect(state.labels).toStrictEqual([]);
      expect(state.labelUpdateCalls).toStrictEqual([]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("rejects changing system or unknown labels", () => {
    const { layer, state } = createTestLayer({ cachedLabels: [INBOX_LABEL] });

    return Effect.gen(function* rejectsInvalidLabelChanges() {
      const gmail = yield* Gmail;
      const account = yield* gmail.authorizeAccount({
        accessToken: "access-a",
        scopes: [GMAIL_FULL_ACCESS_SCOPE],
      });

      const errors = yield* Effect.all(
        [INBOX_LABEL.id, LabelId.make("Label_missing")].flatMap((labelId) => [
          gmail
            .deleteLabel({ accountId: account.id, labelId })
            .pipe(Effect.flip),
          gmail
            .updateLabel({
              accountId: account.id,
              labelId,
              name: "Changed",
            })
            .pipe(Effect.flip),
        ])
      );

      expect(errors.map((error) => error._tag)).toStrictEqual([
        "GmailValidationError",
        "GmailValidationError",
        "GmailValidationError",
        "GmailValidationError",
      ]);
      expect(state.labelDeleteCalls).toStrictEqual([]);
      expect(state.labelUpdateCalls).toStrictEqual([]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("rejects system labels as thread label mutations", () => {
    const { layer, state } = createTestLayer({ cachedLabels: [INBOX_LABEL] });

    return Effect.gen(function* rejectsSystemLabels() {
      const gmail = yield* Gmail;
      const account = yield* gmail.authorizeAccount({
        accessToken: "access-a",
        scopes: [GMAIL_FULL_ACCESS_SCOPE],
      });
      const error = yield* gmail
        .setThreadLabel({
          accountId: account.id,
          applied: false,
          labelId: INBOX_LABEL.id,
          threadId: ThreadId.make("thread-1"),
        })
        .pipe(Effect.flip);

      expect(error._tag).toBe("GmailValidationError");
      expect(state.labelMutationCalls).toStrictEqual([]);
      expect(state.threadLabelChanges).toStrictEqual([]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("combines attachments when forwarding", () => {
    const { layer, state } = createTestLayer();

    return Effect.gen(function* forwardsAttachments() {
      const gmail = yield* Gmail;
      const account = yield* gmail.authorizeAccount(
        authHandoff("access-a", "refresh-a")
      );
      const sent = yield* gmail.forward({
        accountId: account.id,
        attachments: [
          {
            bytes: new Uint8Array([4, 5, 6]),
            filename: "notes.txt",
            mediaType: "text/plain",
          },
        ],
        body: { text: "FYI", type: "text" },
        forwardMessageId: MessageId.make("message-1"),
        threadId: ThreadId.make("thread-1"),
        to: [new Mailbox({ address: "recipient@example.com" })],
      });

      expect(sent.id).toBe("sent-message");
      expect(state.attachmentCalls).toStrictEqual(["attachment-1"]);
      expect(state.forwardAttachmentContentIds).toStrictEqual([
        "logo@example.com",
        undefined,
      ]);
      expect(state.sendCalls).toBe(1);
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "reconciles a thread when a forwarded attachment is missing",
    () => {
      const { layer, state } = createTestLayer({ attachmentNotFound: true });

      return Effect.gen(function* reconcilesForwardAttachment() {
        const gmail = yield* Gmail;
        const account = yield* gmail.authorizeAccount(authHandoff("access-a"));
        const threadId = ThreadId.make("thread-1");

        const error = yield* gmail
          .forward({
            accountId: account.id,
            body: { text: "FYI", type: "text" },
            forwardMessageId: MessageId.make("message-1"),
            threadId,
            to: [new Mailbox({ address: "recipient@example.com" })],
          })
          .pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: "GmailEntityNotFoundError",
          reconciledThread: { outcome: "refreshed", threadId },
          resource: "attachment",
        });
        expect(state.getThreadCalls).toHaveLength(2);
        expect(state.savedThreadIds).toStrictEqual([threadId]);
        expect(state.sendCalls).toBe(0);
      }).pipe(Effect.provide(layer));
    }
  );

  it.effect("does not treat initial mailbox hydration as new mail", () => {
    const { layer, state } = createTestLayer();

    return Effect.gen(function* ignoresInitialMailbox() {
      const gmail = yield* Gmail;
      const account = yield* gmail.authorizeAccount(
        authHandoff("access-a", "refresh-a")
      );
      const result = yield* gmail.sync({
        accountId: account.id,
        reason: "startup",
      });

      expect(result.type).toBe("initial");
      expect(result.addedMessageIds).toStrictEqual([]);
      expect(state.labelListCalls).toBe(1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("preserves only incremental message-added signals", () => {
    const addedMessageId = MessageId.make("new-message");
    const { layer, state } = createTestLayer({
      historyAddedMessageIds: [addedMessageId],
      syncCursor: HistoryId.make("history-before"),
    });

    return Effect.gen(function* preservesAddedMessages() {
      const gmail = yield* Gmail;
      const account = yield* gmail.authorizeAccount(
        authHandoff("access-a", "refresh-a")
      );
      const result = yield* gmail.sync({
        accountId: account.id,
        reason: "timer",
      });

      expect(result.type).toBe("partial");
      expect(result.addedMessageIds).toStrictEqual([addedMessageId]);
      expect(state.labelListCalls).toBe(0);
    }).pipe(Effect.provide(layer));
  });

  it.effect("gets labels first seen during incremental history", () => {
    const { layer, state } = createTestLayer({
      cachedLabels: [INBOX_LABEL],
      historyThreads: [
        threadSummaryWithLabels([INBOX_LABEL.id, UNKNOWN_LABEL_ID]),
      ],
      syncCursor: HistoryId.make("history-before"),
    });

    return Effect.gen(function* repairsTheCatalogFromHistory() {
      const gmail = yield* Gmail;
      const account = yield* gmail.authorizeAccount(
        authHandoff("access-a", "refresh-a")
      );

      yield* gmail.sync({ accountId: account.id, reason: "timer" });
      yield* gmail.sync({ accountId: account.id, reason: "timer" });

      expect(state.labelGetCalls).toStrictEqual([UNKNOWN_LABEL_ID]);
      expect(state.labels.map((label) => label.name)).toStrictEqual([
        "INBOX",
        "New label",
      ]);
      expect(state.labelListCalls).toBe(0);
    }).pipe(Effect.provide(layer));
  });

  it.effect("gets labels first seen during indexed thread pages", () => {
    const { layer, state } = createTestLayer({
      cachedLabels: [INBOX_LABEL],
      threadLabelIds: [INBOX_LABEL.id, UNKNOWN_LABEL_ID],
    });

    return Effect.gen(function* repairsTheCatalogDuringIndexing() {
      const gmail = yield* Gmail;
      const account = yield* gmail.authorizeAccount(
        authHandoff("access-a", "refresh-a")
      );

      yield* gmail.listThreads({
        accountId: account.id,
        labelIds: [INBOX_LABEL.id],
        pageSize: 50,
      });

      expect(state.labelGetCalls).toStrictEqual([UNKNOWN_LABEL_ID]);
      expect(state.labelListCalls).toBe(0);
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "does not refresh labels while recovering an expired cursor",
    () => {
      const { layer, state } = createTestLayer({
        cachedLabels: [INBOX_LABEL],
        historyExpired: true,
        syncCursor: HistoryId.make("history-before"),
        threadLabelIds: [INBOX_LABEL.id, UNKNOWN_LABEL_ID],
      });

      return Effect.gen(function* recoversWithoutRefreshingLabels() {
        const gmail = yield* Gmail;
        const account = yield* gmail.authorizeAccount(
          authHandoff("access-a", "refresh-a")
        );
        const result = yield* gmail.sync({
          accountId: account.id,
          reason: "timer",
        });

        expect(result.type).toBe("cursor-recovered");
        expect(state.labelListCalls).toBe(0);
        expect(state.labelGetCalls).toStrictEqual([UNKNOWN_LABEL_ID]);
      }).pipe(Effect.provide(layer));
    }
  );

  it.effect("reads cached labels unless a manual refresh is requested", () => {
    const cachedLabel = new GmailLabel({
      id: LabelId.make("Label_1"),
      name: "Receipts",
      type: "user",
    });
    const { layer, state } = createTestLayer({ cachedLabels: [cachedLabel] });

    return Effect.gen(function* respectsExplicitLabelRefresh() {
      const gmail = yield* Gmail;
      const account = yield* gmail.authorizeAccount(
        authHandoff("access-a", "refresh-a")
      );

      expect(yield* gmail.listLabels({ accountId: account.id })).toStrictEqual([
        cachedLabel,
      ]);
      expect(state.labelListCalls).toBe(0);

      yield* gmail.listLabels({ accountId: account.id, refresh: true });
      expect(state.labelListCalls).toBe(1);
    }).pipe(Effect.provide(layer));
  });
});
