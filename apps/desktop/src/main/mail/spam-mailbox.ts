import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import {
  gmailMessages,
  gmailSyncState,
  gmailThreads,
  googleAccounts,
} from "@repo/database/schemas";
import { and, eq, inArray } from "drizzle-orm";

export const hasUnreadSpamRemote = async (
  database: RemoteDatabaseClient,
  requestedAccountIds: readonly string[]
): Promise<boolean> => {
  if (requestedAccountIds.length === 0) {
    return false;
  }

  const thread = await database
    .select({ threadId: gmailThreads.threadId })
    .from(gmailThreads)
    .innerJoin(
      googleAccounts,
      eq(googleAccounts.email, gmailThreads.accountEmail)
    )
    .where(
      and(
        inArray(gmailThreads.accountEmail, [...new Set(requestedAccountIds)]),
        eq(gmailThreads.isInSpam, true),
        eq(gmailThreads.isUnread, true)
      )
    )
    .limit(1)
    .get();

  return thread !== undefined;
};

export const resetSpamBackfillRemote = (
  database: RemoteDatabaseClient,
  accountId: string,
  now: number
): Promise<readonly string[]> =>
  database.transaction(async (transaction) => {
    const rows = await transaction
      .select({ threadId: gmailThreads.threadId })
      .from(gmailThreads)
      .where(
        and(
          eq(gmailThreads.accountEmail, accountId),
          eq(gmailThreads.isInSpam, true)
        )
      )
      .all();
    const threadIds = rows.map(({ threadId }) => threadId);

    if (threadIds.length > 0) {
      await transaction
        .delete(gmailMessages)
        .where(
          and(
            eq(gmailMessages.accountEmail, accountId),
            inArray(gmailMessages.threadId, threadIds)
          )
        )
        .run();
      await transaction
        .delete(gmailThreads)
        .where(
          and(
            eq(gmailThreads.accountEmail, accountId),
            inArray(gmailThreads.threadId, threadIds)
          )
        )
        .run();
    }

    await transaction
      .update(gmailSyncState)
      .set({
        spamBackfillComplete: false,
        spamBackfillCursor: null,
        updatedAt: now,
      })
      .where(eq(gmailSyncState.accountEmail, accountId))
      .run();

    return threadIds;
  });
