import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import type { StoredMailAttachment } from "./mail-messages";

/**
 * The per-conversation projection the mailbox list pages over. It is
 * recomputed from `mail_messages` in the transaction that changes them.
 */
export const mailThreads = sqliteTable(
  "mail_threads",
  {
    accountId: text("account_id").notNull(),
    attachments: text("attachments", { mode: "json" })
      .$type<
        readonly (StoredMailAttachment & { readonly messageId: string })[]
      >()
      .notNull(),
    /** The newest message's sender. */
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    hasAttachments: integer("has_attachments", { mode: "boolean" }).notNull(),
    /** Indexed projections so mailbox pages never scan label JSON. */
    isInInbox: integer("is_in_inbox", { mode: "boolean" }).notNull(),
    isInSent: integer("is_in_sent", { mode: "boolean" }).notNull(),
    isInSpam: integer("is_in_spam", { mode: "boolean" }).notNull(),
    isInTrash: integer("is_in_trash", { mode: "boolean" }).notNull(),
    isUnread: integer("is_unread", { mode: "boolean" }).notNull(),
    labelIds: text("label_ids", { mode: "json" })
      .$type<readonly string[]>()
      .notNull(),
    latestAt: integer("latest_at").notNull(),
    latestMessageId: text("latest_message_id").notNull(),
    messageCount: integer("message_count").notNull(),
    snippet: text("snippet").notNull(),
    /** When the thread first appeared in Spam, for the new-spam indicator. */
    spamAddedAt: integer("spam_added_at"),
    subject: text("subject").notNull(),
    threadId: text("thread_id").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.threadId] }),
    // Each mirrors the list's keyset order (equality on the projection, then
    // latest_at DESC with ASC tiebreakers) so a page is an index range scan.
    index("mail_threads_inbox_idx").on(
      table.isInInbox,
      sql`${table.latestAt} desc`,
      table.accountId,
      table.threadId
    ),
    index("mail_threads_sent_idx").on(
      table.isInSent,
      sql`${table.latestAt} desc`,
      table.accountId,
      table.threadId
    ),
    index("mail_threads_spam_idx").on(
      table.isInSpam,
      sql`${table.latestAt} desc`,
      table.accountId,
      table.threadId
    ),
    index("mail_threads_trash_idx").on(
      table.isInTrash,
      sql`${table.latestAt} desc`,
      table.accountId,
      table.threadId
    ),
    // Unread conversations outside Spam and Trash, which the unread counts
    // and the labels' counts read on every change to the list. SQLite uses
    // it only for a query that states these conditions as literals.
    index("mail_threads_unread_idx")
      .on(table.accountId, table.isInInbox)
      .where(
        sql`${table.isUnread} = 1 and ${table.isInSpam} = 0 and ${table.isInTrash} = 0`
      ),
  ]
);
