CREATE TABLE `gmail_sync_state` (
	`account_email` text PRIMARY KEY NOT NULL,
	`history_id` text NOT NULL,
	`updated_at` integer NOT NULL
);
