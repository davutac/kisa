CREATE TABLE `gmail_sender_brands` (
	`authority_url` text,
	`domain` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`logo_data` blob,
	`logo_url` text,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL
);
