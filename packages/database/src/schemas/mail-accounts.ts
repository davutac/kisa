import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * One connected mailbox account of any provider. `credentials` is the
 * `safeStorage`-sealed app password; it never leaves main.
 */
export const mailAccounts = sqliteTable("mail_accounts", {
  /** The normalized address, the account's identity everywhere else. */
  accountId: text("account_id").primaryKey(),
  createdAt: integer("created_at").notNull(),
  credentials: blob("credentials", { mode: "buffer" }).notNull(),
  dialect: text("dialect", { enum: ["generic", "gmail"] }).notNull(),
  /** The sender name on outgoing mail, if the user gave one. */
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
