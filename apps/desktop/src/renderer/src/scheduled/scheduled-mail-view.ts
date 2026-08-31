import type {
  ScheduledMailAttentionReason,
  ScheduledMailChanged,
  ScheduledMailEditSession,
  ScheduledMailSummary,
} from "@/shared/ipc/scheduled-mail";

export const getScheduledMailKey = (
  item: Pick<ScheduledMailSummary, "accountId" | "draftId">
): string => `${item.accountId}\u0000${item.draftId}`;

export const shouldCloseScheduledMailEditor = (
  change: ScheduledMailChanged,
  session: ScheduledMailEditSession
): boolean =>
  change.kind === "remove" &&
  change.accountId === session.item.accountId &&
  change.draftId === session.item.draftId;

const ATTENTION_COPY = {
  "account-action-required": "Sign in again before this email can be sent",
  "attachment-changed": "An attachment changed after it was scheduled",
  "attachment-invalid": "An attachment is no longer available",
  "attachment-missing": "An attachment is missing",
  "attachment-too-large": "The attachments are too large",
  "delivery-rejected": "Gmail rejected this email",
  "message-invalid": "Review the message before sending",
  "outcome-unknown": "Delivery could not be confirmed; check Sent",
  "rate-limit-exhausted": "Gmail kept delaying this email",
} as const satisfies Record<ScheduledMailAttentionReason, string>;

export const getScheduledMailAttentionCopy = (
  reason?: ScheduledMailAttentionReason
): string =>
  reason === undefined
    ? "Review this email before sending"
    : ATTENTION_COPY[reason];

export const orderScheduledMailItems = (
  items: readonly ScheduledMailSummary[]
): readonly ScheduledMailSummary[] =>
  items.toSorted((left, right) => {
    const leftAttention = left.deliveryState === "attention" ? 0 : 1;
    const rightAttention = right.deliveryState === "attention" ? 0 : 1;
    return (
      leftAttention - rightAttention ||
      left.scheduledAt - right.scheduledAt ||
      left.accountId.localeCompare(right.accountId) ||
      left.draftId.localeCompare(right.draftId)
    );
  });

export const getScheduledRecipientSummary = (
  recipients: readonly string[]
): string => {
  const first = recipients[0] ?? "No recipient";
  const remaining = recipients.length - 1;
  return remaining > 0 ? `${first} +${remaining}` : first;
};
