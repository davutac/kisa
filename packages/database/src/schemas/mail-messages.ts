import { sql } from "drizzle-orm";
import {
  blob,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export interface StoredMailAttachment {
  readonly contentId?: string;
  readonly disposition?: "attachment" | "inline";
  /** The part's transfer encoding, removed when the bytes are fetched. */
  readonly encoding?: string;
  readonly filename: string;
  readonly mediaType: string;
  /** The IMAP section the bytes are fetched from when the user opens it. */
  readonly section: string;
  readonly size: number;
}

export interface StoredMailHeader {
  readonly name: string;
  readonly value: string;
}

/**
 * One logical message. Metadata arrives with the skeleton; `body_state`
 * moves to `ready` once the text parts are stored, or `failed` when they
 * could not be read.
 *
 * `body_text` stays uncompressed because `mail_messages_fts` reads it as
 * external content. `body_html` is gzipped, which is where most bytes are.
 */
export const mailMessages = sqliteTable(
  "mail_messages",
  {
    // Columns are in the order SQLite stores them, set by the migration that
    // put the bodies last: what the engine reads most comes first, and a body,
    // often spilling into overflow pages, comes after everything else, so
    // reading a message's thread or subject does not walk through it. Drizzle
    // recreates a table in this order, so keep it.
    accountId: text("account_id").notNull(),
    messageId: text("message_id").notNull(),
    threadId: text("thread_id").notNull(),
    /** When the server received it (INTERNALDATE), epoch milliseconds. */
    receivedAt: integer("received_at").notNull(),
    isUnread: integer("is_unread", { mode: "boolean" }).notNull(),
    isStarred: integer("is_starred", { mode: "boolean" }).notNull(),
    isDraft: integer("is_draft", { mode: "boolean" }).notNull(),
    bodyState: text("body_state", { enum: ["failed", "none", "ready"] })
      .notNull()
      .default("none"),
    size: integer("size").notNull(),
    /** The union of the labels its copies give it. */
    labelIds: text("label_ids", { mode: "json" })
      .$type<readonly string[]>()
      .notNull(),
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    subject: text("subject").notNull(),
    snippet: text("snippet").notNull().default(""),
    attachments: text("attachments", { mode: "json" }).$type<
      readonly StoredMailAttachment[]
    >(),
    hasAttachments: integer("has_attachments", { mode: "boolean" })
      .notNull()
      .default(false),
    hasBlockedRemoteImages: integer("has_blocked_remote_images", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    senderAuthenticated: integer("sender_authenticated", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Which body parser produced the stored body. */
    schemaVersion: integer("schema_version").notNull().default(0),
    /** The `Date` header, epoch milliseconds, when it parsed. */
    sentAt: integer("sent_at"),
    updatedAt: integer("updated_at").notNull(),
    rfc822MessageId: text("rfc822_message_id"),
    inReplyTo: text("in_reply_to"),
    /** First `References` entry, kept so threads can be recomputed. */
    firstReference: text("first_reference"),
    replyToAddress: text("reply_to_address"),
    toAddresses: text("to_addresses", { mode: "json" })
      .$type<readonly string[]>()
      .notNull(),
    ccAddresses: text("cc_addresses", { mode: "json" })
      .$type<readonly string[]>()
      .notNull(),
    bccAddresses: text("bcc_addresses", { mode: "json" })
      .$type<readonly string[]>()
      .notNull(),
    /** The few raw headers sender branding and replies need. */
    headers: text("headers", { mode: "json" }).$type<
      readonly StoredMailHeader[]
    >(),
    bodyText: text("body_text"),
    bodyHtml: blob("body_html", { mode: "buffer" }),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.messageId] }),
    index("mail_messages_thread_idx").on(table.accountId, table.threadId),
    // Bodies are fetched newest first; this keeps that query a range scan.
    index("mail_messages_body_queue_idx").on(
      table.accountId,
      table.bodyState,
      sql`${table.receivedAt} desc`
    ),
    index("mail_messages_rfc822_idx").on(
      table.accountId,
      table.rfc822MessageId
    ),
    // Sender suggestions group messages by address on each keystroke, and a
    // `from:` search matches every message's address and name. The index
    // holds both, and what that search returns, so neither reads the table.
    index("mail_messages_from_idx").on(
      table.accountId,
      table.fromAddress,
      table.fromName,
      table.receivedAt,
      table.threadId
    ),
  ]
);
