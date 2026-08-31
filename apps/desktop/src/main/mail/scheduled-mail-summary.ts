import { truncateGmailSubject } from "../../shared/gmail-subject";
import type { ScheduledMailSummary } from "../../shared/ipc/scheduled-mail";
import type {
  JoinedScheduledMessage,
  ScheduledMessageRow,
} from "./scheduled-mail-database";
import { truncateScheduledMailPreview } from "./scheduled-mail-preview";

const getDeliveryState = (
  schedule: ScheduledMessageRow
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
  row: JoinedScheduledMessage
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
