CREATE TABLE `gmail_trusted_image_senders` (
	`account_email` text NOT NULL,
	`created_at` integer NOT NULL,
	`sender_email` text NOT NULL,
	PRIMARY KEY(`account_email`, `sender_email`)
);
