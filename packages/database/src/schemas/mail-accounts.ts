import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * One connected mailbox account of any provider. `credentials` is the
 * `safeStorage`-encrypted sign-in (OAuth tokens or an app password); it never
 * leaves main.
 */
export const mailAccounts = sqliteTable("mail_accounts", {
  /** The normalized address, the account's identity everywhere else. */
  accountId: text("account_id").primaryKey(),
  authKind: text("auth_kind", { enum: ["google-oauth", "password"] }).notNull(),
  // Avatar bytes are cached locally: hotlinking a provider's CDN from the
  // renderer gets the whole account rate-limited and every avatar breaks.
  avatarData: blob("avatar_data", { mode: "buffer" }),
  avatarMediaType: text("avatar_media_type"),
  /** Where the cached avatar came from, to refetch it only when it changes. */
  avatarUrl: text("avatar_url"),
  createdAt: integer("created_at").notNull(),
  credentials: blob("credentials", { mode: "buffer" }).notNull(),
  dialect: text("dialect", { enum: ["generic", "gmail"] }).notNull(),
  displayName: text("display_name"),
  /** The address as the user wrote it, for display. */
  email: text("email").notNull(),
  imapHost: text("imap_host").notNull(),
  imapPort: integer("imap_port").notNull(),
  imapSecurity: text("imap_security", { enum: ["starttls", "tls"] }).notNull(),
  provider: text("provider", { enum: ["gmail", "icloud", "imap"] }).notNull(),
  smtpHost: text("smtp_host").notNull(),
  smtpPort: integer("smtp_port").notNull(),
  smtpSecurity: text("smtp_security", { enum: ["starttls", "tls"] }).notNull(),
  sortOrder: integer("sort_order").notNull(),
  updatedAt: integer("updated_at").notNull(),
  /** The sign-in name, usually the address. */
  username: text("username").notNull(),
});
