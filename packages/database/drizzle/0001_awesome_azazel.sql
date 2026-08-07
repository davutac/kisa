CREATE TABLE `google_accounts` (
	`created_at` integer NOT NULL,
	`credentials` blob NOT NULL,
	`email` text PRIMARY KEY NOT NULL,
	`scopes` text NOT NULL,
	`updated_at` integer NOT NULL
);
