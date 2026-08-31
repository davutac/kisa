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
CREATE INDEX `scheduled_messages_due_idx` ON `scheduled_messages` (`status`,`next_attempt_at`,`scheduled_at`,`draft_id`);