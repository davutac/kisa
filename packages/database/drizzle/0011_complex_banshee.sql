CREATE TABLE `account_settings` (
	`account_email` text PRIMARY KEY NOT NULL,
	`show_system_labels` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL
);
