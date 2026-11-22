import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * One physical copy of a message on the server. A message keeps its id and
 * bodies while its copies move between mailboxes; it is deleted only when a
 * complete pass leaves it without any copy.
 */
export const mailMessageLocations = sqliteTable(
  "mail_message_locations",
  {
    accountId: text("account_id").notNull(),
    flags: text("flags", { mode: "json" }).$type<readonly string[]>().notNull(),
    /** The labels this copy gives its message (folder, read state, star). */
    labelIds: text("label_ids", { mode: "json" })
      .$type<readonly string[]>()
      .notNull(),
    mailboxPath: text("mailbox_path").notNull(),
    messageId: text("message_id").notNull(),
    modseq: text("modseq"),
    uid: integer("uid").notNull(),
    uidValidity: text("uid_validity").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.accountId, table.mailboxPath, table.uid],
    }),
    index("mail_message_locations_message_idx").on(
      table.accountId,
      table.messageId
    ),
  ]
);
