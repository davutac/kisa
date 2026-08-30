import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import { gmailBackfillState } from "@repo/database/schemas";

/**
 * Starts a fresh index walk without removing mail that is already usable.
 * Existing thread, message, and FTS rows are replaced by normal account-scoped
 * upserts as Gmail is walked again. Reindex progress is indeterminate because
 * those preserved rows cannot say which conversations this run has revisited.
 * Persisting `running` keeps the reset restart-safe if the process exits before
 * the in-memory queue starts the account.
 */
export const resetMailIndexRemote = async (
  database: RemoteDatabaseClient,
  accountId: string
): Promise<void> => {
  const resetState = {
    completedAt: null,
    estimatedThreads: 0,
    indexedMessages: 0,
    indexedThreads: 0,
    lastError: null,
    oldestIndexedAt: null,
    pageToken: null,
    startedAt: null,
    status: "running" as const,
    updatedAt: Date.now(),
  };

  await database
    .insert(gmailBackfillState)
    .values({ accountEmail: accountId, ...resetState })
    .onConflictDoUpdate({
      set: resetState,
      target: gmailBackfillState.accountEmail,
    })
    .run();
};
