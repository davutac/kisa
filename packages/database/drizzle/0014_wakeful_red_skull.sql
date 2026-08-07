CREATE TABLE `gmail_backfill_state` (
	`account_email` text PRIMARY KEY NOT NULL,
	`completed_at` integer,
	`estimated_threads` integer,
	`indexed_messages` integer DEFAULT 0 NOT NULL,
	`indexed_threads` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`oldest_indexed_at` integer,
	`page_token` text,
	`started_at` integer,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gmail_messages` (
	`account_email` text NOT NULL,
	`attachments` text,
	`bcc_addresses` text,
	`body_html` blob,
	`body_text` text,
	`cc_addresses` text,
	`from_address` text NOT NULL,
	`from_name` text,
	`has_blocked_remote_images` integer,
	`internal_date` integer NOT NULL,
	`label_ids` text,
	`message_id` text NOT NULL,
	`reply_to_address` text,
	`schema_version` integer NOT NULL,
	`subject` text NOT NULL,
	`thread_id` text NOT NULL,
	`to_addresses` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`account_email`, `message_id`)
);
--> statement-breakpoint
CREATE INDEX `gmail_messages_thread_idx` ON `gmail_messages` (`account_email`,`thread_id`);--> statement-breakpoint
CREATE INDEX `gmail_messages_date_idx` ON `gmail_messages` (`account_email`,`internal_date`);--> statement-breakpoint
ALTER TABLE `gmail_threads` ADD `is_in_inbox` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `gmail_threads_mailbox_idx` ON `gmail_threads` (`is_in_inbox`,"latest_at" desc,`account_email`,`thread_id`);