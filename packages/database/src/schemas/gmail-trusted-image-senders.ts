import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// Senders whose remote images may load without asking, kept per account so
// trusting a sender in one mailbox says nothing about the others.
export const gmailTrustedImageSenders = sqliteTable(
  "gmail_trusted_image_senders",
  {
    accountEmail: text("account_email").notNull(),
    createdAt: integer("created_at").notNull(),
    senderEmail: text("sender_email").notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountEmail, table.senderEmail] })]
);
