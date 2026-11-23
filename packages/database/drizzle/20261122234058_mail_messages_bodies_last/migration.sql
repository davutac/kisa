-- Hand-written: Drizzle neither models nor preserves column order.
--
-- `mail_messages` kept its columns in alphabetical order, which put each
-- message's body, often tens of kilobytes spilling into overflow pages, in the
-- middle of its row. SQLite reaches a column by walking the row from its start,
-- so reading a message's thread, sender, subject or labels walked through its
-- body first: search, thread projections and lookups by message read every
-- cached body to get at a few bytes. The table is rebuilt with the columns the
-- engine reads most at the front and the bodies last. Rowids are kept, so the
-- full-text index, which names rows by rowid, stays valid; the indexes and
-- triggers dropped with the old table are created again as they were.
CREATE TABLE `__new_mail_messages` (
	`account_id` text NOT NULL,
	`message_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`received_at` integer NOT NULL,
	`is_unread` integer NOT NULL,
	`is_starred` integer NOT NULL,
	`is_draft` integer NOT NULL,
	`body_state` text DEFAULT 'none' NOT NULL,
	`size` integer NOT NULL,
	`label_ids` text NOT NULL,
	`from_address` text NOT NULL,
	`from_name` text,
	`subject` text NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`attachments` text,
	`has_attachments` integer DEFAULT false NOT NULL,
	`has_blocked_remote_images` integer DEFAULT false NOT NULL,
	`sender_authenticated` integer DEFAULT false NOT NULL,
	`schema_version` integer DEFAULT 0 NOT NULL,
	`sent_at` integer,
	`updated_at` integer NOT NULL,
	`rfc822_message_id` text,
	`in_reply_to` text,
	`first_reference` text,
	`reply_to_address` text,
	`to_addresses` text NOT NULL,
	`cc_addresses` text NOT NULL,
	`bcc_addresses` text NOT NULL,
	`headers` text,
	`body_text` text,
	`body_html` blob,
	CONSTRAINT `mail_messages_pk` PRIMARY KEY(`account_id`, `message_id`)
);
--> statement-breakpoint
INSERT INTO `__new_mail_messages` (`rowid`, `account_id`, `message_id`, `thread_id`, `received_at`, `is_unread`, `is_starred`, `is_draft`, `body_state`, `size`, `label_ids`, `from_address`, `from_name`, `subject`, `snippet`, `attachments`, `has_attachments`, `has_blocked_remote_images`, `sender_authenticated`, `schema_version`, `sent_at`, `updated_at`, `rfc822_message_id`, `in_reply_to`, `first_reference`, `reply_to_address`, `to_addresses`, `cc_addresses`, `bcc_addresses`, `headers`, `body_text`, `body_html`)
SELECT `rowid`, `account_id`, `message_id`, `thread_id`, `received_at`, `is_unread`, `is_starred`, `is_draft`, `body_state`, `size`, `label_ids`, `from_address`, `from_name`, `subject`, `snippet`, `attachments`, `has_attachments`, `has_blocked_remote_images`, `sender_authenticated`, `schema_version`, `sent_at`, `updated_at`, `rfc822_message_id`, `in_reply_to`, `first_reference`, `reply_to_address`, `to_addresses`, `cc_addresses`, `bcc_addresses`, `headers`, `body_text`, `body_html`
FROM `mail_messages`;
--> statement-breakpoint
-- Dropping the table drops its indexes and triggers before it deletes its
-- rows, so no trigger touches the full-text index here.
DROP TABLE `mail_messages`;
--> statement-breakpoint
ALTER TABLE `__new_mail_messages` RENAME TO `mail_messages`;
--> statement-breakpoint
CREATE INDEX `mail_messages_thread_idx` ON `mail_messages` (`account_id`,`thread_id`);
--> statement-breakpoint
CREATE INDEX `mail_messages_body_queue_idx` ON `mail_messages` (`account_id`,`body_state`,"received_at" desc);
--> statement-breakpoint
CREATE INDEX `mail_messages_rfc822_idx` ON `mail_messages` (`account_id`,`rfc822_message_id`);
--> statement-breakpoint
CREATE INDEX `mail_messages_sender_idx` ON `mail_messages` (`account_id`,`from_address`);
--> statement-breakpoint
CREATE TRIGGER `mail_messages_fts_insert` AFTER INSERT ON `mail_messages` BEGIN
  INSERT INTO `mail_messages_fts`(`rowid`, `subject`, `from_address`, `body_text`)
  VALUES (new.`rowid`, new.`subject`, new.`from_address`, new.`body_text`);
END;
--> statement-breakpoint
CREATE TRIGGER `mail_messages_fts_delete` AFTER DELETE ON `mail_messages` BEGIN
  INSERT INTO `mail_messages_fts`(`mail_messages_fts`, `rowid`, `subject`, `from_address`, `body_text`)
  VALUES ('delete', old.`rowid`, old.`subject`, old.`from_address`, old.`body_text`);
END;
--> statement-breakpoint
-- Only columns the index reads fire a rewrite: label and read-state changes
-- touch messages constantly and must not re-tokenize their bodies.
CREATE TRIGGER `mail_messages_fts_update` AFTER UPDATE OF `subject`, `from_address`, `body_text` ON `mail_messages` BEGIN
  INSERT INTO `mail_messages_fts`(`mail_messages_fts`, `rowid`, `subject`, `from_address`, `body_text`)
  VALUES ('delete', old.`rowid`, old.`subject`, old.`from_address`, old.`body_text`);
  INSERT INTO `mail_messages_fts`(`rowid`, `subject`, `from_address`, `body_text`)
  VALUES (new.`rowid`, new.`subject`, new.`from_address`, new.`body_text`);
END;
