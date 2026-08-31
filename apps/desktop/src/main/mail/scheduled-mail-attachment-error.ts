import { Schema } from "effect";

export type ScheduledMailAttachmentReason =
  | "attachment-changed"
  | "attachment-invalid"
  | "attachment-missing"
  | "attachment-too-large";

// oxlint-disable-next-line unicorn/throw-new-error -- Effect Schema tagged errors are declared as generated classes.
export class ScheduledMailAttachmentError extends Schema.TaggedError<ScheduledMailAttachmentError>()(
  "ScheduledMailAttachmentError",
  {
    reason: Schema.Literals([
      "attachment-changed",
      "attachment-invalid",
      "attachment-missing",
      "attachment-too-large",
    ]),
  }
) {}

export const scheduledMailAttachmentError = (
  reason: ScheduledMailAttachmentReason
): ScheduledMailAttachmentError => new ScheduledMailAttachmentError({ reason });
