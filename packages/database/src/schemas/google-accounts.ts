import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const googleAccounts = sqliteTable("google_accounts", {
  // Avatar bytes are cached locally: hotlinking Google's CDN from the renderer
  // gets the whole account rate-limited (429) and every avatar breaks at once.
  avatarData: blob("avatar_data", { mode: "buffer" }),
  avatarMediaType: text("avatar_media_type"),
  avatarUrl: text("avatar_url"),
  createdAt: integer("created_at").notNull(),
  credentials: blob("credentials", { mode: "buffer" }).notNull(),
  displayName: text("display_name"),
  email: text("email").primaryKey(),
  scopes: text("scopes").notNull(),
  sortOrder: integer("sort_order").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
