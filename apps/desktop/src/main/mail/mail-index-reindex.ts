import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import {
  gmailBackfillState,
  gmailMessages,
  gmailThreads,
} from "@repo/database/schemas";
import { and, eq, inArray } from "drizzle-orm";

export const unmarkMailIndexRemote = async (
  database: Pick<RemoteDatabaseClient, "update">,
  accountId: string
): Promise<void> => {
  await database
    .update(gmailThreads)
    .set({ isIndexSeen: false })
    .where(eq(gmailThreads.accountEmail, accountId))
    .run();
};

/** Delete only after a complete walk proves which Gmail threads still exist. */
export const sweepUnseenMailRemote = async (
  database: RemoteDatabaseClient,
  accountId: string
): Promise<void> => {
  await database.transaction(async (transaction) => {
    const unseenThreadIds = transaction
      .select({ threadId: gmailThreads.threadId })
      .from(gmailThreads)
      .where(
        and(
          eq(gmailThreads.accountEmail, accountId),
          eq(gmailThreads.isIndexSeen, false)
        )
      );

    await transaction
      .delete(gmailMessages)
      .where(
        and(
          eq(gmailMessages.accountEmail, accountId),
          inArray(gmailMessages.threadId, unseenThreadIds)
        )
      )
      .run();
    await transaction
      .delete(gmailThreads)
      .where(
        and(
          eq(gmailThreads.accountEmail, accountId),
          eq(gmailThreads.isIndexSeen, false)
        )
      )
      .run();
  });
};

/**
 * Starts a fresh index walk without removing mail that is already usable.
 * Existing thread, message, and FTS rows are replaced by normal account-scoped
 * upserts as Gmail is walked again. Reindex progress is indeterminate because
 * those preserved rows cannot say which conversations this run has revisited.
 * Persisting `running` keeps the reset restart-safe if the process exits before
 * the in-memory run starts for the account.
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

  await database.transaction(async (transaction) => {
    await unmarkMailIndexRemote(transaction, accountId);
    await transaction
      .insert(gmailBackfillState)
      .values({ accountEmail: accountId, ...resetState })
      .onConflictDoUpdate({
        set: resetState,
        target: gmailBackfillState.accountEmail,
      })
      .run();
  });
};
