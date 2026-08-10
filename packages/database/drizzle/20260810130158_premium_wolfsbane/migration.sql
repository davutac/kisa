CREATE TABLE `mail_drafts` (
	`account_email` text,
	`attachments` text NOT NULL,
	`bcc` text NOT NULL,
	`body_html` text NOT NULL,
	`body_text` text NOT NULL,
	`cc` text NOT NULL,
	`created_at` integer NOT NULL,
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`message_id` text,
	`subject` text NOT NULL,
	`thread_id` text,
	`to` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_drafts_stashes_idx` ON `mail_drafts` (`kind`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `mail_drafts_thread_idx` ON `mail_drafts` (`account_email`,`thread_id`) WHERE "mail_drafts"."thread_id" is not null;