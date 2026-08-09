import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const accountSettings = sqliteTable("account_settings", {
  accountEmail: text("account_email").primaryKey(),
  notificationsEnabled: integer("notifications_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  showSystemLabels: integer("show_system_labels", { mode: "boolean" })
    .notNull()
    .default(true),
  updatedAt: integer("updated_at").notNull(),
});
