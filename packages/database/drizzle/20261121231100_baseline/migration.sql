CREATE TABLE `account_settings` (
	`account_email` text PRIMARY KEY,
	`categorization_enabled` integer DEFAULT false NOT NULL,
	`email_signature` text DEFAULT '{"html":"","text":""}' NOT NULL,
	`notifications_enabled` integer DEFAULT true NOT NULL,
	`show_system_labels` integer DEFAULT true NOT NULL,
	`spam_last_checked_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_settings` (
	`active_provider` text,
	`claude_model` text DEFAULT 'claude-sonnet-5' NOT NULL,
	`claude_reasoning` text,
	`cleanup_instructions` text DEFAULT '' NOT NULL,
	`codex_model` text DEFAULT 'gpt-5.6-luna' NOT NULL,
	`codex_reasoning` text DEFAULT 'low',
	`id` integer PRIMARY KEY,
	`opencode_model` text,
	`opencode_reasoning` text,
	`reply_instructions` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `composer_templates` (
	`account_email` text,
	`bcc` text NOT NULL,
	`body_html` text NOT NULL,
	`body_text` text NOT NULL,
	`cc` text NOT NULL,
	`created_at` integer NOT NULL,
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`subject` text NOT NULL,
	`to` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_composer_templates_account_email_mail_accounts_account_id_fk` FOREIGN KEY (`account_email`) REFERENCES `mail_accounts`(`account_id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `mail_accounts` (
	`account_id` text PRIMARY KEY,
	`auth_kind` text NOT NULL,
	`avatar_data` blob,
	`avatar_media_type` text,
	`avatar_url` text,
	`created_at` integer NOT NULL,
	`credentials` blob NOT NULL,
	`dialect` text NOT NULL,
	`display_name` text,
	`email` text NOT NULL,
	`imap_host` text NOT NULL,
	`imap_port` integer NOT NULL,
	`imap_security` text NOT NULL,
	`provider` text NOT NULL,
	`smtp_host` text NOT NULL,
	`smtp_port` integer NOT NULL,
	`smtp_security` text NOT NULL,
	`sort_order` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`username` text NOT NULL
);
--> statement-breakpoint
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
	`signature_account_email` text,
	`signature_html` text,
	`signature_text` text,
	`subject` text NOT NULL,
	`thread_id` text,
	`to` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mail_labels` (
	`account_id` text NOT NULL,
	`background_color` text,
	`kind` text NOT NULL,
	`label_id` text NOT NULL,
	`mailbox_path` text,
	`name` text NOT NULL,
	`text_color` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT `mail_labels_pk` PRIMARY KEY(`account_id`, `label_id`)
);
--> statement-breakpoint
CREATE TABLE `mail_mailboxes` (
	`account_id` text NOT NULL,
	`delimiter` text NOT NULL,
	`highest_modseq` text,
	`message_count` integer,
	`path` text NOT NULL,
	`role` text NOT NULL,
	`selectable` integer NOT NULL,
	`skeleton_floor` integer,
	`synced` integer NOT NULL,
	`uid_next` integer,
	`uid_validity` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT `mail_mailboxes_pk` PRIMARY KEY(`account_id`, `path`)
);
--> statement-breakpoint
CREATE TABLE `mail_message_locations` (
	`account_id` text NOT NULL,
	`flags` text NOT NULL,
	`label_ids` text NOT NULL,
	`mailbox_path` text NOT NULL,
	`message_id` text NOT NULL,
	`modseq` text,
	`uid` integer NOT NULL,
	`uid_validity` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `mail_message_locations_pk` PRIMARY KEY(`account_id`, `mailbox_path`, `uid`)
);
--> statement-breakpoint
CREATE TABLE `mail_messages` (
	`account_id` text NOT NULL,
	`attachments` text,
	`bcc_addresses` text NOT NULL,
	`body_html` blob,
	`body_state` text DEFAULT 'none' NOT NULL,
	`body_text` text,
	`cc_addresses` text NOT NULL,
	`first_reference` text,
	`from_address` text NOT NULL,
	`from_name` text,
	`has_attachments` integer DEFAULT false NOT NULL,
	`has_blocked_remote_images` integer DEFAULT false NOT NULL,
	`headers` text,
	`in_reply_to` text,
	`is_draft` integer NOT NULL,
	`is_starred` integer NOT NULL,
	`is_unread` integer NOT NULL,
	`label_ids` text NOT NULL,
	`message_id` text NOT NULL,
	`received_at` integer NOT NULL,
	`reply_to_address` text,
	`rfc822_message_id` text,
	`schema_version` integer DEFAULT 0 NOT NULL,
	`sender_authenticated` integer DEFAULT false NOT NULL,
	`sent_at` integer,
	`size` integer NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`subject` text NOT NULL,
	`thread_id` text NOT NULL,
	`to_addresses` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `mail_messages_pk` PRIMARY KEY(`account_id`, `message_id`)
);
--> statement-breakpoint
CREATE TABLE `mail_sender_brands` (
	`authority_url` text,
	`domain` text NOT NULL,
	`expires_at` integer NOT NULL,
	`logo_data` blob,
	`logo_url` text,
	`selector` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `mail_sender_brands_pk` PRIMARY KEY(`domain`, `selector`)
);
--> statement-breakpoint
CREATE TABLE `mail_threads` (
	`account_id` text NOT NULL,
	`attachments` text NOT NULL,
	`from_address` text NOT NULL,
	`from_name` text,
	`has_attachments` integer NOT NULL,
	`is_in_inbox` integer NOT NULL,
	`is_in_sent` integer NOT NULL,
	`is_in_spam` integer NOT NULL,
	`is_in_trash` integer NOT NULL,
	`is_unread` integer NOT NULL,
	`label_ids` text NOT NULL,
	`latest_at` integer NOT NULL,
	`latest_message_id` text NOT NULL,
	`message_count` integer NOT NULL,
	`snippet` text NOT NULL,
	`spam_added_at` integer,
	`subject` text NOT NULL,
	`thread_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `mail_threads_pk` PRIMARY KEY(`account_id`, `thread_id`)
);
--> statement-breakpoint
CREATE TABLE `mail_trusted_image_senders` (
	`account_email` text NOT NULL,
	`created_at` integer NOT NULL,
	`sender_email` text NOT NULL,
	CONSTRAINT `mail_trusted_image_senders_pk` PRIMARY KEY(`account_email`, `sender_email`)
);
--> statement-breakpoint
CREATE TABLE `scheduled_messages` (
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`attempt_id` text,
	`attention_reason` text,
	`created_at` integer NOT NULL,
	`draft_id` text PRIMARY KEY,
	`last_attempt_at` integer,
	`next_attempt_at` integer,
	`notification_claim_id` text,
	`notification_claimed_at` integer,
	`notified_at` integer,
	`rate_limit_started_at` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`rfc_message_id` text NOT NULL,
	`scheduled_at` integer NOT NULL,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_scheduled_messages_draft_id_mail_drafts_id_fk` FOREIGN KEY (`draft_id`) REFERENCES `mail_drafts`(`id`) ON DELETE CASCADE,
	CONSTRAINT "scheduled_messages_attempt_count_check" CHECK("attempt_count" >= 0),
	CONSTRAINT "scheduled_messages_revision_check" CHECK("revision" >= 1),
	CONSTRAINT "scheduled_messages_rfc_message_id_check" CHECK(length("rfc_message_id") > 0),
	CONSTRAINT "scheduled_messages_state_check" CHECK((
        ("status" = 'scheduled' AND "next_attempt_at" IS NOT NULL AND "attempt_id" IS NULL AND "attention_reason" IS NULL)
        OR ("status" = 'preparing' AND "next_attempt_at" IS NULL AND "attempt_id" IS NOT NULL AND "attention_reason" IS NULL)
        OR ("status" = 'sending' AND "next_attempt_at" IS NULL AND "attempt_id" IS NOT NULL AND "attention_reason" IS NULL)
        OR ("status" = 'sent' AND "next_attempt_at" IS NULL AND "attempt_id" IS NULL AND "attention_reason" IS NULL)
        OR ("status" = 'attention' AND "next_attempt_at" IS NULL AND "attempt_id" IS NULL AND "attention_reason" IS NOT NULL)
      )),
	CONSTRAINT "scheduled_messages_attention_reason_check" CHECK("attention_reason" IS NULL OR "attention_reason" IN (
        'account-action-required',
        'attachment-missing',
        'attachment-changed',
        'attachment-invalid',
        'attachment-too-large',
        'message-invalid',
        'delivery-rejected',
        'rate-limit-exhausted',
        'outcome-unknown'
      )),
	CONSTRAINT "scheduled_messages_notification_claim_check" CHECK((
        ("notification_claim_id" IS NULL AND "notification_claimed_at" IS NULL)
        OR ("notification_claim_id" IS NOT NULL AND "notification_claimed_at" IS NOT NULL)
      )),
	CONSTRAINT "scheduled_messages_notification_terminal_check" CHECK((
        ("notification_claim_id" IS NULL AND "notification_claimed_at" IS NULL AND "notified_at" IS NULL)
        OR "status" IN ('sent', 'attention')
      ))
);
--> statement-breakpoint
CREATE TABLE `test` (
	`id` integer PRIMARY KEY
);
--> statement-breakpoint
CREATE INDEX `composer_templates_name_idx` ON `composer_templates` (`name`);--> statement-breakpoint
CREATE INDEX `mail_drafts_stashes_idx` ON `mail_drafts` (`kind`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `mail_drafts_thread_idx` ON `mail_drafts` (`account_email`,`thread_id`) WHERE "mail_drafts"."thread_id" is not null;--> statement-breakpoint
CREATE INDEX `mail_message_locations_message_idx` ON `mail_message_locations` (`account_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `mail_messages_thread_idx` ON `mail_messages` (`account_id`,`thread_id`);--> statement-breakpoint
CREATE INDEX `mail_messages_body_queue_idx` ON `mail_messages` (`account_id`,`body_state`,"received_at" desc);--> statement-breakpoint
CREATE INDEX `mail_messages_rfc822_idx` ON `mail_messages` (`account_id`,`rfc822_message_id`);--> statement-breakpoint
CREATE INDEX `mail_messages_sender_idx` ON `mail_messages` (`account_id`,`from_address`);--> statement-breakpoint
CREATE INDEX `mail_threads_inbox_idx` ON `mail_threads` (`is_in_inbox`,"latest_at" desc,`account_id`,`thread_id`);--> statement-breakpoint
CREATE INDEX `mail_threads_sent_idx` ON `mail_threads` (`is_in_sent`,"latest_at" desc,`account_id`,`thread_id`);--> statement-breakpoint
CREATE INDEX `mail_threads_spam_idx` ON `mail_threads` (`is_in_spam`,"latest_at" desc,`account_id`,`thread_id`);--> statement-breakpoint
CREATE INDEX `mail_threads_trash_idx` ON `mail_threads` (`is_in_trash`,"latest_at" desc,`account_id`,`thread_id`);--> statement-breakpoint
CREATE INDEX `scheduled_messages_due_idx` ON `scheduled_messages` (`status`,`next_attempt_at`,`scheduled_at`,`draft_id`);--> statement-breakpoint
-- Hand-written: Drizzle does not model FTS5. External content keeps one copy
-- of every body; triggers keep the index in step on every path rows leave by.
CREATE VIRTUAL TABLE `mail_messages_fts` USING fts5(
  `subject`,
  `from_address`,
  `body_text`,
  content=`mail_messages`,
  tokenize='unicode61 remove_diacritics 2'
);
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
