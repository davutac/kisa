import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const gmailLabels = sqliteTable(
  "gmail_labels",
  {
    accountEmail: text("account_email").notNull(),
    backgroundColor: text("background_color"),
    labelId: text("label_id").notNull(),
    name: text("name").notNull(),
    textColor: text("text_color"),
    type: text("type"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountEmail, table.labelId] })]
);
