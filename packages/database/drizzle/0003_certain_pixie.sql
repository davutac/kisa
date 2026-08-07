CREATE TABLE `gmail_threads` (
	`account_email` text NOT NULL,
	`from` text NOT NULL,
	`is_unread` integer NOT NULL,
	`latest_at` integer NOT NULL,
	`message_count` integer NOT NULL,
	`snippet` text NOT NULL,
	`subject` text NOT NULL,
	`thread_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`account_email`, `thread_id`)
);
