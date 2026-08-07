import type { Effect, Option } from "effect";
import { Context } from "effect";

import type { GmailStoreError } from "./errors";
import type {
  AccountId,
  GmailAccount,
  GmailAuthorization,
  GmailCredentialPatch,
  GmailLabel,
  GmailThread,
  HistoryId,
  ThreadId,
  ThreadSummary,
} from "./models";

export interface GmailStoreService {
  readonly clearAccount: (
    accountId: AccountId
  ) => Effect.Effect<void, GmailStoreError>;
  readonly getAuthorization: (
    accountId: AccountId
  ) => Effect.Effect<Option.Option<GmailAuthorization>, GmailStoreError>;
  readonly getLabels: (
    accountId: AccountId
  ) => Effect.Effect<readonly GmailLabel[], GmailStoreError>;
  readonly getSyncCursor: (
    accountId: AccountId
  ) => Effect.Effect<Option.Option<HistoryId>, GmailStoreError>;
  readonly getThread: (
    accountId: AccountId,
    threadId: ThreadId
  ) => Effect.Effect<Option.Option<GmailThread>, GmailStoreError>;
  readonly listAccounts: Effect.Effect<
    readonly GmailAccount[],
    GmailStoreError
  >;
  readonly removeThreads: (
    accountId: AccountId,
    threadIds: readonly ThreadId[]
  ) => Effect.Effect<void, GmailStoreError>;
  readonly replaceLabels: (
    accountId: AccountId,
    labels: readonly GmailLabel[]
  ) => Effect.Effect<void, GmailStoreError>;
  readonly saveAuthorization: (
    authorization: GmailAuthorization
  ) => Effect.Effect<void, GmailStoreError>;
  readonly saveSyncCursor: (
    accountId: AccountId,
    historyId: HistoryId
  ) => Effect.Effect<void, GmailStoreError>;
  readonly saveThread: (
    accountId: AccountId,
    thread: GmailThread
  ) => Effect.Effect<void, GmailStoreError>;
  readonly setThreadReadState: (
    accountId: AccountId,
    threadId: ThreadId,
    isRead: boolean
  ) => Effect.Effect<void, GmailStoreError>;
  readonly updateCredentials: (
    accountId: AccountId,
    patch: GmailCredentialPatch
  ) => Effect.Effect<void, GmailStoreError>;
  readonly upsertThreadSummaries: (
    accountId: AccountId,
    threads: readonly ThreadSummary[]
  ) => Effect.Effect<void, GmailStoreError>;
}

export class GmailStore extends Context.Service<
  GmailStore,
  GmailStoreService
>()("@repo/gmail/GmailStore") {}
