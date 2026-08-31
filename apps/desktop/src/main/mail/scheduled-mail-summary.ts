import { mailDrafts, scheduledMessages } from "@repo/database/schemas";

import { truncateGmailSubject } from "../../shared/gmail-subject";
import type { ScheduledMailSummary } from "../../shared/ipc/scheduled-mail";
import type {
  MailDraftRow,
  ScheduledMessageRow,
} from "./scheduled-mail-database";
import { truncateScheduledMailPreview } from "./scheduled-mail-preview";

export const scheduledMailSummarySelection = {
  draft: {
    accountEmail: mailDrafts.accountEmail,
    attachments: mailDrafts.attachments,
    bcc: mailDrafts.bcc,
    bodyText: mailDrafts.bodyText,
    cc: mailDrafts.cc,
    id: mailDrafts.id,
    subject: mailDrafts.subject,
    to: mailDrafts.to,
  },
  schedule: {
    attemptCount: scheduledMessages.attemptCount,
    attentionReason: scheduledMessages.attentionReason,
    nextAttemptAt: scheduledMessages.nextAttemptAt,
    rateLimitStartedAt: scheduledMessages.rateLimitStartedAt,
    revision: scheduledMessages.revision,
    scheduledAt: scheduledMessages.scheduledAt,
    status: scheduledMessages.status,
  },
};

type ScheduledMailSummaryDraftRow = Pick<
  MailDraftRow,
  | "accountEmail"
  | "attachments"
  | "bcc"
  | "bodyText"
  | "cc"
  | "id"
  | "subject"
  | "to"
>;

type ScheduledMailSummaryScheduleRow = Pick<
  ScheduledMessageRow,
  | "attentionReason"
  | "attemptCount"
  | "nextAttemptAt"
  | "rateLimitStartedAt"
  | "revision"
  | "scheduledAt"
  | "status"
>;

export interface ScheduledMailSummaryRow {
  readonly draft: ScheduledMailSummaryDraftRow;
  readonly schedule: ScheduledMailSummaryScheduleRow;
}

const getDeliveryState = (
  schedule: ScheduledMailSummaryScheduleRow
): ScheduledMailSummary["deliveryState"] => {
  if (schedule.status === "attention") {
    return "attention";
  }
  if (schedule.status === "preparing" || schedule.status === "sending") {
    return "sending";
  }
  if (schedule.attemptCount > 0 || schedule.rateLimitStartedAt !== null) {
    return "retrying";
  }
  return "scheduled";
};

export const toScheduledMailSummary = (
  row: ScheduledMailSummaryRow
): ScheduledMailSummary => {
  const { draft, schedule } = row;
  let summary: ScheduledMailSummary = {
    accountId: draft.accountEmail ?? "",
    attachments: draft.attachments.map(({ filename, mediaType }) => ({
      filename,
      mediaType,
    })),
    deliveryState: getDeliveryState(schedule),
    draftId: draft.id,
    preview: truncateScheduledMailPreview(draft.bodyText),
    recipients: [...draft.to, ...draft.cc, ...draft.bcc],
    revision: schedule.revision,
    scheduledAt: schedule.scheduledAt,
    subject: truncateGmailSubject(draft.subject),
  };
  if (schedule.attentionReason !== null) {
    summary = { ...summary, attentionReason: schedule.attentionReason };
  }
  if (schedule.nextAttemptAt !== null) {
    summary = { ...summary, nextAttemptAt: schedule.nextAttemptAt };
  }
  return summary;
};
