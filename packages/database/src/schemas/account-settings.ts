import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export interface StoredEmailSignature {
  readonly html: string;
  readonly text: string;
}

export const accountSettings = sqliteTable("account_settings", {
  accountEmail: text("account_email").primaryKey(),
  emailSignature: text("email_signature", { mode: "json" })
    .$type<StoredEmailSignature>()
    .notNull()
    .default({ html: "", text: "" }),
  notificationsEnabled: integer("notifications_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  showSystemLabels: integer("show_system_labels", { mode: "boolean" })
    .notNull()
    .default(true),
  spamLastCheckedAt: integer("spam_last_checked_at").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});
