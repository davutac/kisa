import {
  blob,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * An image part a message's HTML shows with a `cid:` url, kept once fetched so
 * opening the conversation again needs no server. Only images a body names
 * and the inline budget allows are kept, and only for conversations opened.
 * Rows leave with their message, with their account, and once unused for
 * longer than the user keeps them.
 */
export const mailInlineImages = sqliteTable(
  "mail_inline_images",
  {
    accountId: text("account_id").notNull(),
    data: blob("data", { mode: "buffer" }).notNull(),
    mediaType: text("media_type").notNull(),
    messageId: text("message_id").notNull(),
    /** The IMAP section the image was fetched from. */
    section: text("section").notNull(),
    /**
     * When the image was last shown, in epoch milliseconds, kept to the day.
     * Rows from before it was recorded read as never shown.
     */
    usedAt: integer("used_at").notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [table.accountId, table.messageId, table.section],
    }),
    // Clearing unused images reads this index, never the images themselves.
    index("mail_inline_images_used_idx").on(table.accountId, table.usedAt),
  ]
);
