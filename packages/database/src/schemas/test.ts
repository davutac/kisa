import { sqliteTable, integer } from "drizzle-orm/sqlite-core";

export const test = sqliteTable("test", {
  id: integer("id").primaryKey(),
});
