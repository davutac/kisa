import {
  primaryKey,
  sqliteTable,
  text,
  integer,
} from "drizzle-orm/sqlite-core";

/** System labels and user labels (Gmail labels or plain folders). */
export const mailLabels = sqliteTable(
  "mail_labels",
  {
    accountId: text("account_id").notNull(),
    /**
     * Kisa's own colour, as `#rrggbb`; IMAP has no label colours. A user label
     * gets one when sync first sees it, and keeps it once chosen.
     */
    backgroundColor: text("background_color"),
    kind: text("kind", { enum: ["system", "user"] }).notNull(),
    labelId: text("label_id").notNull(),
    /** The mailbox that holds the label's messages, for user labels. */
    mailboxPath: text("mailbox_path"),
    name: text("name").notNull(),
    /** Unused: the text colour is derived from the background. */
    textColor: text("text_color"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.labelId] })]
);
