ALTER TABLE `ai_settings` ADD `claude_reasoning` text;--> statement-breakpoint
ALTER TABLE `ai_settings` ADD `codex_reasoning` text DEFAULT 'low';--> statement-breakpoint
ALTER TABLE `ai_settings` ADD `opencode_reasoning` text;