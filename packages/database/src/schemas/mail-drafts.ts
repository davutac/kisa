import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export type MailDraftKind = "forward" | "new" | "reply" | "reply-all";

export interface StoredMailDraftAttachment {
  readonly authorizationVersion: 1;
  readonly birthtimeMs: number;
  readonly device: string;
  readonly filename: string;
  readonly id: string;
  readonly inode: string;
  readonly mediaType: string;
  readonly mtimeMs: number;
  readonly path: string;
  readonly size: number;
}

/** Local compositions. Thread drafts are unique per account and conversation. */
export const mailDrafts = sqliteTable(
  "mail_drafts",
  {
    accountEmail: text("account_email"),
    attachments: text("attachments", { mode: "json" })
      .$type<readonly StoredMailDraftAttachment[]>()
      .notNull(),
    bcc: text("bcc", { mode: "json" }).$type<readonly string[]>().notNull(),
    bodyHtml: text("body_html").notNull(),
    bodyText: text("body_text").notNull(),
    cc: text("cc", { mode: "json" }).$type<readonly string[]>().notNull(),
    createdAt: integer("created_at").notNull(),
    id: text("id").primaryKey(),
    kind: text("kind").$type<MailDraftKind>().notNull(),
    messageId: text("message_id"),
    signatureAccountEmail: text("signature_account_email"),
    signatureHtml: text("signature_html"),
    signatureText: text("signature_text"),
    subject: text("subject").notNull(),
    threadId: text("thread_id"),
    to: text("to", { mode: "json" }).$type<readonly string[]>().notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("mail_drafts_stashes_idx").on(table.kind, table.updatedAt),
    uniqueIndex("mail_drafts_thread_idx")
      .on(table.accountEmail, table.threadId)
      .where(sql`${table.threadId} is not null`),
  ]
);
