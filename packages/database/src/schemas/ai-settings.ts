import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const aiSettings = sqliteTable("ai_settings", {
  activeProvider: text("active_provider"),
  claudeModel: text("claude_model").notNull().default("claude-sonnet-5"),
  cleanupInstructions: text("cleanup_instructions").notNull().default(""),
  codexModel: text("codex_model").notNull().default("gpt-5.6-luna"),
  id: integer("id").primaryKey(),
  openCodeModel: text("opencode_model"),
  replyInstructions: text("reply_instructions").notNull().default(""),
  updatedAt: integer("updated_at").notNull(),
});
