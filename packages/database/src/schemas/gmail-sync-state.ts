import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const gmailSyncState = sqliteTable("gmail_sync_state", {
  accountEmail: text("account_email").primaryKey(),
  historyId: text("history_id").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
