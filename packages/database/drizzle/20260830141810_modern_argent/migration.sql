ALTER TABLE `gmail_threads` ADD `is_in_sent` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `gmail_threads`
SET `is_in_sent` = true
WHERE EXISTS (
  SELECT 1
  FROM json_each(coalesce(`gmail_threads`.`labels`, '[]')) AS `thread_label`
  WHERE upper(`thread_label`.`value`) = 'SENT'
);--> statement-breakpoint
CREATE INDEX `gmail_threads_sent_mailbox_idx` ON `gmail_threads` (`is_in_sent`,"latest_at" desc,`account_email`,`thread_id`);
