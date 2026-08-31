import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { mailDrafts } from "./mail-drafts";

export type ScheduledMessageStatus =
  | "attention"
  | "preparing"
  | "scheduled"
  | "sending"
  | "sent";

export type ScheduledMessageAttentionReason =
  | "account-action-required"
  | "attachment-changed"
  | "attachment-invalid"
  | "attachment-missing"
  | "attachment-too-large"
  | "delivery-rejected"
  | "message-invalid"
  | "outcome-unknown"
  | "rate-limit-exhausted";

/** Delivery lifecycle metadata for a locally stored new-message draft. */
export const scheduledMessages = sqliteTable(
  "scheduled_messages",
  {
    attemptCount: integer("attempt_count").notNull().default(0),
    attemptId: text("attempt_id"),
    attentionReason:
      text("attention_reason").$type<ScheduledMessageAttentionReason>(),
    createdAt: integer("created_at").notNull(),
    draftId: text("draft_id")
      .primaryKey()
      .references(() => mailDrafts.id, { onDelete: "cascade" }),
    lastAttemptAt: integer("last_attempt_at"),
    nextAttemptAt: integer("next_attempt_at"),
    notificationClaimId: text("notification_claim_id"),
    notificationClaimedAt: integer("notification_claimed_at"),
    notifiedAt: integer("notified_at"),
    rateLimitStartedAt: integer("rate_limit_started_at"),
    revision: integer("revision").notNull().default(1),
    rfcMessageId: text("rfc_message_id").notNull(),
    scheduledAt: integer("scheduled_at").notNull(),
    status: text("status").$type<ScheduledMessageStatus>().notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("scheduled_messages_due_idx").on(
      table.status,
      table.nextAttemptAt,
      table.scheduledAt,
      table.draftId
    ),
    check(
      "scheduled_messages_attempt_count_check",
      sql`${table.attemptCount} >= 0`
    ),
    check("scheduled_messages_revision_check", sql`${table.revision} >= 1`),
    check(
      "scheduled_messages_rfc_message_id_check",
      sql`length(${table.rfcMessageId}) > 0`
    ),
    check(
      "scheduled_messages_state_check",
      sql`(
        (${table.status} = 'scheduled' AND ${table.nextAttemptAt} IS NOT NULL AND ${table.attemptId} IS NULL AND ${table.attentionReason} IS NULL)
        OR (${table.status} = 'preparing' AND ${table.nextAttemptAt} IS NULL AND ${table.attemptId} IS NOT NULL AND ${table.attentionReason} IS NULL)
        OR (${table.status} = 'sending' AND ${table.nextAttemptAt} IS NULL AND ${table.attemptId} IS NOT NULL AND ${table.attentionReason} IS NULL)
        OR (${table.status} = 'sent' AND ${table.nextAttemptAt} IS NULL AND ${table.attemptId} IS NULL AND ${table.attentionReason} IS NULL)
        OR (${table.status} = 'attention' AND ${table.nextAttemptAt} IS NULL AND ${table.attemptId} IS NULL AND ${table.attentionReason} IS NOT NULL)
      )`
    ),
    check(
      "scheduled_messages_attention_reason_check",
      sql`${table.attentionReason} IS NULL OR ${table.attentionReason} IN (
        'account-action-required',
        'attachment-missing',
        'attachment-changed',
        'attachment-invalid',
        'attachment-too-large',
        'message-invalid',
        'delivery-rejected',
        'rate-limit-exhausted',
        'outcome-unknown'
      )`
    ),
    check(
      "scheduled_messages_notification_claim_check",
      sql`(
        (${table.notificationClaimId} IS NULL AND ${table.notificationClaimedAt} IS NULL)
        OR (${table.notificationClaimId} IS NOT NULL AND ${table.notificationClaimedAt} IS NOT NULL)
      )`
    ),
    check(
      "scheduled_messages_notification_terminal_check",
      sql`(
        (${table.notificationClaimId} IS NULL AND ${table.notificationClaimedAt} IS NULL AND ${table.notifiedAt} IS NULL)
        OR ${table.status} IN ('sent', 'attention')
      )`
    ),
  ]
);
