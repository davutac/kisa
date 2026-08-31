import * as Schema from "effect/Schema";

import { MAX_GOOGLE_ACCOUNTS } from "./auth";
import {
  MAX_GMAIL_ATTACHMENT_COUNT,
  GmailOutgoingSubject,
  MailDraft,
  MailDraftInput,
} from "./mail";
import { IpcReply } from "./reply";

export const SCHEDULED_MAIL_PAGE_SIZE = 50;
export const MAX_SCHEDULED_MAIL_PREVIEW_LENGTH = 240;

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export const ScheduledMailAttentionReason = Schema.Literals([
  "account-action-required",
  "attachment-changed",
  "attachment-invalid",
  "attachment-missing",
  "attachment-too-large",
  "delivery-rejected",
  "message-invalid",
  "outcome-unknown",
  "rate-limit-exhausted",
]);
export type ScheduledMailAttentionReason =
  typeof ScheduledMailAttentionReason.Type;

export const ScheduledMailDeliveryState = Schema.Literals([
  "attention",
  "retrying",
  "scheduled",
  "sending",
]);
export type ScheduledMailDeliveryState = typeof ScheduledMailDeliveryState.Type;

export const ScheduledMailKey = Schema.Struct({
  accountId: Schema.NonEmptyString,
  draftId: Schema.NonEmptyString,
});
export type ScheduledMailKey = typeof ScheduledMailKey.Type;

export const ScheduledMailScope = Schema.Struct({
  accountIds: Schema.Array(Schema.NonEmptyString).check(
    Schema.isMaxLength(MAX_GOOGLE_ACCOUNTS)
  ),
});
export type ScheduledMailScope = typeof ScheduledMailScope.Type;

export const ScheduledMailAttachmentSummary = Schema.Struct({
  filename: Schema.NonEmptyString,
  mediaType: Schema.NonEmptyString,
});
export type ScheduledMailAttachmentSummary =
  typeof ScheduledMailAttachmentSummary.Type;

export const ScheduledMailSummary = Schema.Struct({
  ...ScheduledMailKey.fields,
  attachments: Schema.Array(ScheduledMailAttachmentSummary).check(
    Schema.isMaxLength(MAX_GMAIL_ATTACHMENT_COUNT)
  ),
  attentionReason: Schema.optional(ScheduledMailAttentionReason),
  deliveryState: ScheduledMailDeliveryState,
  nextAttemptAt: Schema.optional(Schema.Int),
  preview: Schema.String.check(
    Schema.isMaxLength(MAX_SCHEDULED_MAIL_PREVIEW_LENGTH)
  ),
  recipients: Schema.Array(Schema.String),
  revision: PositiveInt,
  scheduledAt: Schema.Int,
  subject: GmailOutgoingSubject,
});
export type ScheduledMailSummary = typeof ScheduledMailSummary.Type;

export const ScheduledMailPageRequest = Schema.Struct({
  ...ScheduledMailScope.fields,
  cursor: Schema.optional(Schema.NonEmptyString),
});
export type ScheduledMailPageRequest = typeof ScheduledMailPageRequest.Type;

export const ScheduledMailPage = Schema.Struct({
  items: Schema.Array(ScheduledMailSummary).check(
    Schema.isMaxLength(SCHEDULED_MAIL_PAGE_SIZE)
  ),
  nextCursor: Schema.optional(Schema.NonEmptyString),
});
export type ScheduledMailPage = typeof ScheduledMailPage.Type;

export const ScheduledMailAttentionCount = Schema.Struct({
  count: NonNegativeInt,
  hasScheduledMail: Schema.Boolean,
});
export type ScheduledMailAttentionCount =
  typeof ScheduledMailAttentionCount.Type;

export const ScheduledMailScheduleRequest = Schema.Struct({
  ...ScheduledMailKey.fields,
  draft: MailDraftInput,
  scheduledAt: Schema.Int,
});
export type ScheduledMailScheduleRequest =
  typeof ScheduledMailScheduleRequest.Type;

export const ScheduledMailEditSession = Schema.Struct({
  draft: MailDraft,
  item: ScheduledMailSummary,
});
export type ScheduledMailEditSession = typeof ScheduledMailEditSession.Type;

const PossibleDuplicateAcknowledgement = {
  allowPossibleDuplicate: Schema.Boolean,
} as const;

export const ScheduledMailEditAction = Schema.Union([
  Schema.Struct({
    draft: MailDraftInput,
    kind: Schema.Literal("save"),
  }),
  Schema.Struct({
    ...PossibleDuplicateAcknowledgement,
    draft: MailDraftInput,
    kind: Schema.Literal("reschedule"),
    scheduledAt: Schema.Int,
  }),
  Schema.Struct({
    ...PossibleDuplicateAcknowledgement,
    draft: MailDraftInput,
    kind: Schema.Literal("send-now"),
  }),
  Schema.Struct({ kind: Schema.Literal("discard") }),
]);
export type ScheduledMailEditAction = typeof ScheduledMailEditAction.Type;

export const ScheduledMailFinishEditRequest = Schema.Struct({
  ...ScheduledMailKey.fields,
  action: ScheduledMailEditAction,
});
export type ScheduledMailFinishEditRequest =
  typeof ScheduledMailFinishEditRequest.Type;

export const ScheduledMailFinishEditResult = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("finished") }),
  Schema.Struct({
    kind: Schema.Literal("saved"),
    session: ScheduledMailEditSession,
  }),
]);
export type ScheduledMailFinishEditResult =
  typeof ScheduledMailFinishEditResult.Type;

export const ScheduledMailSendNowRequest = Schema.Struct({
  ...ScheduledMailKey.fields,
  allowPossibleDuplicate: Schema.Boolean,
});
export type ScheduledMailSendNowRequest =
  typeof ScheduledMailSendNowRequest.Type;

export const ScheduledMailChanged = Schema.Struct({
  ...ScheduledMailKey.fields,
  kind: Schema.Literals(["remove", "upsert"]),
});
export type ScheduledMailChanged = typeof ScheduledMailChanged.Type;

export const ScheduledMailOutcome = Schema.Struct({
  ...ScheduledMailKey.fields,
  intent: Schema.Literals(["feedback", "open"]),
  kind: Schema.Literals(["attention", "sent"]),
});
export type ScheduledMailOutcome = typeof ScheduledMailOutcome.Type;

export const ScheduledMailOutcomeReadiness = Schema.Boolean;
export type ScheduledMailOutcomeReadiness =
  typeof ScheduledMailOutcomeReadiness.Type;

export const ScheduledMailPageReply = IpcReply(ScheduledMailPage);
export type ScheduledMailPageReply = typeof ScheduledMailPageReply.Type;

export const ScheduledMailAttentionCountReply = IpcReply(
  ScheduledMailAttentionCount
);
export type ScheduledMailAttentionCountReply =
  typeof ScheduledMailAttentionCountReply.Type;

export const ScheduledMailSummaryReply = IpcReply(ScheduledMailSummary);
export type ScheduledMailSummaryReply = typeof ScheduledMailSummaryReply.Type;

export const ScheduledMailEditSessionReply = IpcReply(ScheduledMailEditSession);
export type ScheduledMailEditSessionReply =
  typeof ScheduledMailEditSessionReply.Type;

export const ScheduledMailFinishEditReply = IpcReply(
  ScheduledMailFinishEditResult
);
export type ScheduledMailFinishEditReply =
  typeof ScheduledMailFinishEditReply.Type;

export const ScheduledMailActionReply = IpcReply(Schema.Void);
export type ScheduledMailActionReply = typeof ScheduledMailActionReply.Type;
