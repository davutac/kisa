CREATE TABLE `ai_settings` (
	`active_provider` text,
	`claude_model` text DEFAULT 'claude-sonnet-5' NOT NULL,
	`cleanup_instructions` text DEFAULT '' NOT NULL,
	`codex_model` text DEFAULT 'gpt-5.6-luna' NOT NULL,
	`id` integer PRIMARY KEY,
	`opencode_model` text,
	`reply_instructions` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL
);
