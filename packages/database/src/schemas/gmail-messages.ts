import {
  blob,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export interface CachedGmailMessageAttachment {
  attachmentId?: string;
  contentId?: string;
  filename: string;
  mediaType: string;
  messageId: string;
  size: number;
}

/**
 * The indexed copy of every message the backfill walks. `threads.get` already
 * returns full bodies for every thread the app touches, so storing them costs
 * no extra Gmail quota — only disk.
 *
 * `body_text` stays uncompressed because `gmail_messages_fts` reads it as
 * external content. `body_html` is gzipped, which is where the bulk of the
 * bytes are.
 */
export const gmailMessages = sqliteTable(
  "gmail_messages",
  {
    accountEmail: text("account_email").notNull(),
    attachments: text("attachments", { mode: "json" }).$type<
      readonly CachedGmailMessageAttachment[]
    >(),
    bccAddresses: text("bcc_addresses", { mode: "json" }).$type<
      readonly string[]
    >(),
    bodyHtml: blob("body_html", { mode: "buffer" }),
    bodyText: text("body_text"),
    ccAddresses: text("cc_addresses", { mode: "json" }).$type<
      readonly string[]
    >(),
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    hasBlockedRemoteImages: integer("has_blocked_remote_images", {
      mode: "boolean",
    }),
    internalDate: integer("internal_date").notNull(),
    labelIds: text("label_ids", { mode: "json" }).$type<readonly string[]>(),
    messageId: text("message_id").notNull(),
    replyToAddress: text("reply_to_address"),
    /**
     * Which sanitiser produced `body_html`. A future sanitiser change bumps
     * this so stale output can be invalidated rather than silently served.
     */
    schemaVersion: integer("schema_version").notNull(),
    subject: text("subject").notNull(),
    threadId: text("thread_id").notNull(),
    toAddresses: text("to_addresses", { mode: "json" }).$type<
      readonly string[]
    >(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountEmail, table.messageId] }),
    index("gmail_messages_thread_idx").on(table.accountEmail, table.threadId),
    index("gmail_messages_date_idx").on(table.accountEmail, table.internalDate),
  ]
);
