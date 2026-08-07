import {
  blob,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const gmailSenderBrands = sqliteTable(
  "gmail_sender_brands",
  {
    authorityUrl: text("authority_url"),
    domain: text("domain").notNull(),
    expiresAt: integer("expires_at").notNull(),
    logoData: blob("logo_data", { mode: "buffer" }),
    logoUrl: text("logo_url"),
    selector: text("selector").notNull(),
    status: text("status").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.domain, table.selector] })]
);
