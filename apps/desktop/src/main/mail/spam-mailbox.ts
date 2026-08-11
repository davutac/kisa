import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import {
  accountSettings,
  gmailMessages,
  gmailSyncState,
  gmailThreads,
  googleAccounts,
} from "@repo/database/schemas";
import { and, eq, gt, inArray, sql } from "drizzle-orm";

const listConnectedAccountIds = async (
  database: RemoteDatabaseClient,
  requestedAccountIds: readonly string[]
): Promise<readonly string[]> => {
  if (requestedAccountIds.length === 0) {
    return [];
  }

  const accounts = await database
    .select({ accountId: googleAccounts.email })
    .from(googleAccounts)
    .where(inArray(googleAccounts.email, [...new Set(requestedAccountIds)]))
    .all();

  return accounts.map(({ accountId }) => accountId);
};

export const hasNewSpamRemote = async (
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
    .leftJoin(
      accountSettings,
      eq(accountSettings.accountEmail, gmailThreads.accountEmail)
    )
    .where(
      and(
        inArray(gmailThreads.accountEmail, [...new Set(requestedAccountIds)]),
        eq(gmailThreads.isInSpam, true),
        gt(
          gmailThreads.spamAddedAt,
          sql`coalesce(${accountSettings.spamLastCheckedAt}, 0)`
        )
      )
    )
    .limit(1)
    .get();

  return thread !== undefined;
};

export const markSpamSeenRemote = async (
  database: RemoteDatabaseClient,
  requestedAccountIds: readonly string[],
  now: number
): Promise<void> => {
  const accountIds = await listConnectedAccountIds(
    database,
    requestedAccountIds
  );

  if (accountIds.length === 0) {
    return;
  }

  await database
    .insert(accountSettings)
    .values(
      accountIds.map((accountEmail) => ({
        accountEmail,
        spamLastCheckedAt: now,
        updatedAt: now,
      }))
    )
    .onConflictDoUpdate({
      set: { spamLastCheckedAt: now, updatedAt: now },
      target: accountSettings.accountEmail,
    })
    .run();
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
