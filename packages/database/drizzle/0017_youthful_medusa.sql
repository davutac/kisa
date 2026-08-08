ALTER TABLE `google_accounts` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `google_accounts` SET `sort_order` = `created_at`;
