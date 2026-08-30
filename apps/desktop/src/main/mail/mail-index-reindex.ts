import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import {
  gmailBackfillState,
  gmailMessages,
  gmailThreads,
} from "@repo/database/schemas";
import { and, count, eq, inArray } from "drizzle-orm";

/** Counts only mail revisited by the current full-account walk. */
export const readMailIndexCountsRemote = async (
  database: RemoteDatabaseClient,
  accountId: string
): Promise<{ readonly messages: number; readonly threads: number }> => {
  const seenThreadIds = database
    .select({ threadId: gmailThreads.threadId })
    .from(gmailThreads)
    .where(
      and(
        eq(gmailThreads.accountEmail, accountId),
        eq(gmailThreads.isIndexSeen, true)
      )
    );
  const messageRows = await database
    .select({ value: count() })
    .from(gmailMessages)
    .where(
      and(
        eq(gmailMessages.accountEmail, accountId),
        inArray(gmailMessages.threadId, seenThreadIds)
      )
    )
    .all();
  const threadRows = await database
    .select({ value: count() })
    .from(gmailThreads)
    .where(
      and(
        eq(gmailThreads.accountEmail, accountId),
        eq(gmailThreads.isIndexSeen, true)
      )
    )
    .all();

  return {
    messages: messageRows.at(0)?.value ?? 0,
    threads: threadRows.at(0)?.value ?? 0,
  };
};

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
 * upserts as Gmail is walked again. Seen marks distinguish rows revisited by
 * this run, so progress can ignore preserved rows until Gmail returns them.
 * Persisting `running` keeps the reset restart-safe if the process exits before
 * the in-memory run starts for the account.
 */
export const resetMailIndexRemote = async (
  database: RemoteDatabaseClient,
  accountId: string
): Promise<void> => {
  const resetState = {
    completedAt: null,
    estimatedMessages: null,
    estimatedThreads: null,
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
