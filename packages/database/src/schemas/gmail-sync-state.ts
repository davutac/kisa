import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const gmailSyncState = sqliteTable("gmail_sync_state", {
  accountEmail: text("account_email").primaryKey(),
  historyId: text("history_id").notNull(),
  spamBackfillComplete: integer("spam_backfill_complete", { mode: "boolean" })
    .notNull()
    .default(false),
  spamBackfillCursor: text("spam_backfill_cursor"),
  updatedAt: integer("updated_at").notNull(),
});
