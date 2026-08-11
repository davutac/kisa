import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { googleAccounts } from "./google-accounts";

/** Reusable full-composer presets. Account deletion makes a preset portable. */
export const composerTemplates = sqliteTable(
  "composer_templates",
  {
    accountEmail: text("account_email").references(() => googleAccounts.email, {
      onDelete: "set null",
    }),
    bcc: text("bcc", { mode: "json" }).$type<readonly string[]>().notNull(),
    bodyHtml: text("body_html").notNull(),
    bodyText: text("body_text").notNull(),
    cc: text("cc", { mode: "json" }).$type<readonly string[]>().notNull(),
    createdAt: integer("created_at").notNull(),
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    subject: text("subject").notNull(),
    to: text("to", { mode: "json" }).$type<readonly string[]>().notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("composer_templates_name_idx").on(table.name)]
);
