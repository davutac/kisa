// Oxlint does not recognize @effect/vitest's it.effect as a test declaration.
// oxlint-disable vitest/no-standalone-expect sonarjs/no-empty-test-file
import { assert, describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Redacted } from "effect";

import { GmailHistoryExpiredError } from "../src/errors";
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
  GmailAccount,
  GmailCapabilities,
  GmailLabel,
  GmailMessage,
  GmailThread,
  GMAIL_MODIFY_SCOPE,
  GMAIL_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
  HistoryId,
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
  readonly listThreadCalls: {
    readonly accountId: AccountId;
    readonly pageToken?: string;
  }[];
  readonly labelGetCalls: LabelId[];
  readonly labelMutationCalls: {
    readonly addLabelIds: readonly string[];
    readonly removeLabelIds: readonly string[];
    readonly threadId: ThreadId;
  }[];
  labelListCalls: number;
  labels: readonly GmailLabel[];
  readonly mutationCalls: {
    readonly accountId: AccountId;
    readonly operation: "labels" | "trash";
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
  forwardAttachmentContentIds: readonly (string | undefined)[];
  sendCalls: number;
}

interface TestLayerOptions {
  readonly cachedLabels?: readonly GmailLabel[];
  readonly historyAddedMessageIds?: readonly MessageId[];
  readonly historyExpired?: boolean;
  readonly historyThreads?: readonly ThreadSummary[];
  readonly syncCursor?: HistoryId;
  readonly threadLabelIds?: readonly LabelId[];
}

const createTestLayer = (options: TestLayerOptions = {}) => {
  const state: TestState = {
    attachmentCalls: [],
    authorizations: new Map(),
    forwardAttachmentContentIds: [],
    indexedThreadIds: [],
    labelGetCalls: [],
    labelListCalls: 0,
    labelMutationCalls: [],
    labels: options.cachedLabels ?? [],
    listThreadCalls: [],
    mutationCalls: [],
    readStateChanges: [],
    removedThreads: [],
    sendCalls: 0,
    spamStateChanges: [],
    threadLabelChanges: [],
  };

  const store: GmailStoreService = {
    clearAccount: (accountId) =>
      Effect.sync(() => {
        state.authorizations.delete(accountId);
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
    saveThread: () => Effect.void,
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
    getAttachment: (_authorization, request) =>
      Effect.sync(() => {
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
    getThread: () =>
      Effect.succeed({
        value: {
          historyId: HistoryId.make("history-1"),
          id: ThreadId.make("thread-1"),
          labelIds: ["INBOX"],
          messages: [],
        },
      }),
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
      Effect.sync(() => {
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
      Effect.sync(() => {
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
    parseThread: () =>
      Effect.succeed(
        new GmailThread({
          historyId: HistoryId.make("history-1"),
          id: ThreadId.make("thread-1"),
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
              threadId: ThreadId.make("thread-1"),
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

const authHandoff = (accessToken: string, refreshToken?: string): unknown => ({
  accessToken,
  refreshToken,
  scopes: [GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE],
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

  it.effect("derives capabilities from the granted scopes", () => {
    const { layer } = createTestLayer();

    return Effect.gen(function* derivesCapabilities() {
      const gmail = yield* Gmail;
      const account = yield* gmail.authorizeAccount({
        accessToken: "access-a",
        scopes: [GMAIL_READONLY_SCOPE],
      });

      expect(account).toMatchObject(
        new GmailAccount({
          capabilities: new GmailCapabilities({
            modify: false,
            read: true,
            send: false,
          }),
          email: "a@example.com",
          id: AccountId.make("account-a"),
          scopes: [GMAIL_READONLY_SCOPE],
        })
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("marks threads read or unread and moves them to trash", () => {
    const { layer, state } = createTestLayer();

    return Effect.gen(function* mutatesThreads() {
      const gmail = yield* Gmail;
      const account = yield* gmail.authorizeAccount({
        accessToken: "access-a",
        scopes: [GMAIL_MODIFY_SCOPE],
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

  it.effect("moves a thread from Spam to Inbox", () => {
    const { layer, state } = createTestLayer();

    return Effect.gen(function* recoversSpam() {
      const gmail = yield* Gmail;
      const account = yield* gmail.authorizeAccount({
        accessToken: "access-a",
        scopes: [GMAIL_MODIFY_SCOPE],
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
        scopes: [GMAIL_MODIFY_SCOPE],
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

  it.effect("rejects system labels as thread label mutations", () => {
    const { layer, state } = createTestLayer({ cachedLabels: [INBOX_LABEL] });

    return Effect.gen(function* rejectsSystemLabels() {
      const gmail = yield* Gmail;
      const account = yield* gmail.authorizeAccount({
        accessToken: "access-a",
        scopes: [GMAIL_MODIFY_SCOPE],
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

  it.effect("loads original attachments before forwarding", () => {
    const { layer, state } = createTestLayer();

    return Effect.gen(function* forwardsAttachments() {
      const gmail = yield* Gmail;
      const account = yield* gmail.authorizeAccount(
        authHandoff("access-a", "refresh-a")
      );
      const sent = yield* gmail.forward({
        accountId: account.id,
        body: { text: "FYI", type: "text" },
        forwardMessageId: MessageId.make("message-1"),
        threadId: ThreadId.make("thread-1"),
        to: [new Mailbox({ address: "recipient@example.com" })],
      });

      expect(sent.id).toBe("sent-message");
      expect(state.attachmentCalls).toStrictEqual(["attachment-1"]);
      expect(state.forwardAttachmentContentIds).toStrictEqual([
        "logo@example.com",
      ]);
      expect(state.sendCalls).toBe(1);
    }).pipe(Effect.provide(layer));
  });

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
