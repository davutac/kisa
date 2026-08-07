import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export interface CachedGmailAttachment {
  attachmentId?: string;
  filename: string;
  mediaType: string;
  messageId: string;
  size: number;
}

export const gmailThreads = sqliteTable(
  "gmail_threads",
  {
    accountEmail: text("account_email").notNull(),
    attachments: text("attachments", { mode: "json" }).$type<
      readonly CachedGmailAttachment[]
    >(),
    from: text("from").notNull(),
    hasAttachments: integer("has_attachments", { mode: "boolean" }),
    /**
     * Denormalised from `labels` so the inbox predicate can live in SQL. Once
     * the mail index stores archived threads in this table, filtering in
     * JavaScript after a 50-row page means paging through archived mail one
     * page at a time to find inbox rows, and a JSON scan over `labels` cannot
     * use an index.
     */
    isInInbox: integer("is_in_inbox", { mode: "boolean" })
      .notNull()
      .default(false),
    isUnread: integer("is_unread", { mode: "boolean" }).notNull(),
    labels: text("labels", { mode: "json" }).$type<readonly string[]>(),
    latestAt: integer("latest_at").notNull(),
    messageCount: integer("message_count").notNull(),
    snippet: text("snippet").notNull(),
    subject: text("subject").notNull(),
    threadId: text("thread_id").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountEmail, table.threadId] }),
    /**
     * Mirrors `listCachedThreadPage`'s keyset order exactly — equality on
     * `is_in_inbox`, then the ORDER BY columns in their own directions — so a
     * page is an index range scan instead of scanning the tail and sorting it.
     * The DESC matters: SQLite only skips the sort when the index matches the
     * ordering forwards or fully reversed, and the tiebreakers here are ASC.
     */
    index("gmail_threads_mailbox_idx").on(
      table.isInInbox,
      sql`${table.latestAt} desc`,
      table.accountEmail,
      table.threadId
    ),
  ]
);
