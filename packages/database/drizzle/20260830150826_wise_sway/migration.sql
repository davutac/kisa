ALTER TABLE `gmail_threads` ADD `is_in_trash` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `gmail_threads`
SET `is_in_trash` = true
WHERE EXISTS (
  SELECT 1
  FROM json_each(coalesce(`gmail_threads`.`labels`, '[]')) AS `thread_label`
  WHERE upper(`thread_label`.`value`) = 'TRASH'
);--> statement-breakpoint
CREATE INDEX `gmail_threads_trash_mailbox_idx` ON `gmail_threads` (`is_in_trash`,"latest_at" desc,`account_email`,`thread_id`);
