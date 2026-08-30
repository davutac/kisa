import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import { gmailBackfillState } from "@repo/database/schemas";
import { eq } from "drizzle-orm";

/**
 * Starts a fresh index walk without removing mail that is already usable.
 * Existing thread, message, and FTS rows are replaced by normal account-scoped
 * upserts as Gmail is walked again.
 */
export const resetMailIndexRemote = async (
  database: RemoteDatabaseClient,
  accountId: string
): Promise<void> => {
  await database
    .delete(gmailBackfillState)
    .where(eq(gmailBackfillState.accountEmail, accountId))
    .run();
};
