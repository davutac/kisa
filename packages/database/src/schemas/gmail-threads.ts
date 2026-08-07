import {
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
    isUnread: integer("is_unread", { mode: "boolean" }).notNull(),
    labels: text("labels", { mode: "json" }).$type<readonly string[]>(),
    latestAt: integer("latest_at").notNull(),
    messageCount: integer("message_count").notNull(),
    snippet: text("snippet").notNull(),
    subject: text("subject").notNull(),
    threadId: text("thread_id").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountEmail, table.threadId] })]
);
