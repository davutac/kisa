import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export type GmailBackfillStatus =
  | "complete"
  | "failed"
  | "idle"
  | "paused"
  | "running";

/**
 * Resume point for the full-account index, one row per account.
 *
 * The cursor is deliberately two-level. `page_token` is the fast path within a
 * single run, but it does not survive a restart or an invalidated token, so
 * `oldest_indexed_at` is kept as the durable watermark a `before:` query can
 * restart from. Page rows commit before the watermark advances, so a crash can
 * only replay a page, never skip one.
 */
export const gmailBackfillState = sqliteTable("gmail_backfill_state", {
  accountEmail: text("account_email").primaryKey(),
  completedAt: integer("completed_at"),
  estimatedMessages: integer("estimated_messages"),
  estimatedThreads: integer("estimated_threads"),
  indexedMessages: integer("indexed_messages").notNull().default(0),
  indexedThreads: integer("indexed_threads").notNull().default(0),
  lastError: text("last_error"),
  oldestIndexedAt: integer("oldest_indexed_at"),
  pageToken: text("page_token"),
  startedAt: integer("started_at"),
  status: text("status").$type<GmailBackfillStatus>().notNull(),
  updatedAt: integer("updated_at").notNull(),
});
