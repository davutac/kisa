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
    accountId: text("account_id").notNull(),
    attachments: text("attachments", { mode: "json" }).$type<
      readonly StoredMailAttachment[]
    >(),
    bccAddresses: text("bcc_addresses", { mode: "json" })
      .$type<readonly string[]>()
      .notNull(),
    bodyHtml: blob("body_html", { mode: "buffer" }),
    bodyState: text("body_state", { enum: ["failed", "none", "ready"] })
      .notNull()
      .default("none"),
    bodyText: text("body_text"),
    ccAddresses: text("cc_addresses", { mode: "json" })
      .$type<readonly string[]>()
      .notNull(),
    /** First `References` entry, kept so threads can be recomputed. */
    firstReference: text("first_reference"),
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    hasAttachments: integer("has_attachments", { mode: "boolean" })
      .notNull()
      .default(false),
    hasBlockedRemoteImages: integer("has_blocked_remote_images", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    /** The few raw headers sender branding and replies need. */
    headers: text("headers", { mode: "json" }).$type<
      readonly StoredMailHeader[]
    >(),
    inReplyTo: text("in_reply_to"),
    isDraft: integer("is_draft", { mode: "boolean" }).notNull(),
    isStarred: integer("is_starred", { mode: "boolean" }).notNull(),
    isUnread: integer("is_unread", { mode: "boolean" }).notNull(),
    /** The union of the labels its copies give it. */
    labelIds: text("label_ids", { mode: "json" })
      .$type<readonly string[]>()
      .notNull(),
    messageId: text("message_id").notNull(),
    /** When the server received it (INTERNALDATE), epoch milliseconds. */
    receivedAt: integer("received_at").notNull(),
    replyToAddress: text("reply_to_address"),
    rfc822MessageId: text("rfc822_message_id"),
    /** Which body parser produced the stored body. */
    schemaVersion: integer("schema_version").notNull().default(0),
    senderAuthenticated: integer("sender_authenticated", { mode: "boolean" })
      .notNull()
      .default(false),
    /** The `Date` header, epoch milliseconds, when it parsed. */
    sentAt: integer("sent_at"),
    size: integer("size").notNull(),
    snippet: text("snippet").notNull().default(""),
    subject: text("subject").notNull(),
    threadId: text("thread_id").notNull(),
    toAddresses: text("to_addresses", { mode: "json" })
      .$type<readonly string[]>()
      .notNull(),
    updatedAt: integer("updated_at").notNull(),
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
    // Sender suggestions group indexed messages by address on each keystroke;
    // without this the grouping scans every body in the mailbox.
    index("mail_messages_sender_idx").on(table.accountId, table.fromAddress),
  ]
);
