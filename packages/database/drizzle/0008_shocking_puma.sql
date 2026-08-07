CREATE TABLE `gmail_labels` (
	`account_email` text NOT NULL,
	`label_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`account_email`, `label_id`)
);
