// Oxlint does not recognize @effect/vitest's it.effect as a test declaration.
// oxlint-disable vitest/no-standalone-expect sonarjs/no-empty-test-file
import { assert, describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Redacted } from "effect";

import type { GmailGatewayService } from "../src/gateway";
import { GmailGateway } from "../src/gateway";
import { Gmail } from "../src/gmail";
import type { GmailMimeService } from "../src/mime";
import { GmailMime } from "../src/mime";
import type { GmailAuthorization } from "../src/models";
import {
  AccountId,
  GmailAccount,
  GmailCapabilities,
  GMAIL_MODIFY_SCOPE,
  GMAIL_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
  HistoryId,
  LabelId,
  MessageId,
  ThreadId,
  ThreadSummary,
} from "../src/models";
import type { GmailStoreService } from "../src/store";
import { GmailStore } from "../src/store";

interface TestState {
  readonly authorizations: Map<AccountId, GmailAuthorization>;
  readonly listThreadCalls: {
    readonly accountId: AccountId;
    readonly pageToken?: string;
  }[];
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
  readonly removedThreads: ThreadId[];
}

const createTestLayer = () => {
  const state: TestState = {
    authorizations: new Map(),
    listThreadCalls: [],
    mutationCalls: [],
    readStateChanges: [],
    removedThreads: [],
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
    getLabels: () => Effect.succeed([]),
    getSyncCursor: () => Effect.succeed(Option.none()),
    getThread: () => Effect.succeed(Option.none()),
    listAccounts: Effect.sync(() =>
      [...state.authorizations.values()].map(({ account }) => account)
    ),
    removeThreads: (_accountId, threadIds) =>
      Effect.sync(() => {
        state.removedThreads.push(...threadIds);
      }),
    replaceLabels: () => Effect.void,
    saveAuthorization: (authorization) =>
      Effect.sync(() => {
        state.authorizations.set(authorization.account.id, authorization);
      }),
    saveSyncCursor: () => Effect.void,
    saveThread: () => Effect.void,
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
    upsertThreadSummaries: () => Effect.void,
  };

  const gateway: GmailGatewayService = {
    getAttachment: () => Effect.die("unused"),
    getCurrentHistoryId: () => Effect.die("unused"),
    getThread: () => Effect.die("unused"),
    identifyAccount: (credentials) => {
      const token = Redacted.value(credentials.accessToken);
      const suffix = token.at(-1) ?? "a";
      return Effect.succeed({
        email: `${suffix}@example.com`,
        id: AccountId.make(`account-${suffix}`),
      });
    },
    listHistory: () => Effect.die("unused"),
    listLabels: () => Effect.succeed({ value: [] }),
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
          historyId: HistoryId.make("history-1"),
          nextPageToken: request.pageToken === undefined ? "page-2" : undefined,
          threads: [
            new ThreadSummary({
              attachments: [],
              hasAttachments: false,
              hasUnread: true,
              id,
              labelIds: [LabelId.make("INBOX")],
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
        state.mutationCalls.push({
          accountId: authorization.account.id,
          operation: "labels",
          threadId: request.threadId,
          unread: request.addLabelIds.includes("UNREAD"),
        });
        return { value: undefined };
      }),
    revoke: () => Effect.void,
    send: () => Effect.die("unused"),
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
    composeMessage: () => Effect.die("unused"),
    composeReply: () => Effect.die("unused"),
    parseThread: () => Effect.die("unused"),
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
});
