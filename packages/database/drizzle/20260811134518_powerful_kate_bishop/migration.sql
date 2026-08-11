ALTER TABLE `account_settings` ADD `spam_last_checked_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `gmail_sync_state` ADD `spam_backfill_complete` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `gmail_sync_state` ADD `spam_backfill_cursor` text;--> statement-breakpoint
ALTER TABLE `gmail_threads` ADD `is_in_spam` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `gmail_threads` ADD `spam_added_at` integer;--> statement-breakpoint
UPDATE `gmail_threads`
SET `is_in_spam` = 1,
    `spam_added_at` = `updated_at`
WHERE EXISTS (
  SELECT 1
  FROM json_each(coalesce(`gmail_threads`.`labels`, '[]'))
  WHERE json_each.value = 'SPAM'
);--> statement-breakpoint
CREATE INDEX `gmail_threads_spam_mailbox_idx` ON `gmail_threads` (`is_in_spam`,"latest_at" desc,`account_email`,`thread_id`);
