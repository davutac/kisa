import type { EmailRecipients } from "@/components/mail/email-recipient-fields";
import { formatScheduledAt } from "@/scheduled/schedule-time";

export const getComposerDeliveryLabel = (
  isScheduledEdit: boolean,
  scheduledAt?: number
): "Reschedule" | "Schedule" | "Send" | "Send now" => {
  if (scheduledAt !== undefined) {
    return isScheduledEdit ? "Reschedule" : "Schedule";
  }

  return isScheduledEdit ? "Send now" : "Send";
};

export interface ComposerDeliveryTarget {
  readonly recipients: EmailRecipients;
  readonly subject: string;
}

export const describeComposerDelivery = (
  isScheduledEdit: boolean,
  scheduledAt: number | undefined,
  { recipients, subject }: ComposerDeliveryTarget
): string => {
  const trimmedSubject = subject.trim();
  const email = trimmedSubject === "" ? "this email" : `“${trimmedSubject}”`;
  const addresses = [...recipients.to, ...recipients.cc, ...recipients.bcc];

  const target =
    addresses.length === 0 ? email : `${email} to ${addresses.join(", ")}`;

  const when =
    scheduledAt === undefined ? "" : ` for ${formatScheduledAt(scheduledAt)}`;

  switch (getComposerDeliveryLabel(isScheduledEdit, scheduledAt)) {
    case "Reschedule": {
      return `Reschedules ${target}${when}`;
    }

    case "Schedule": {
      return `Schedules ${target}${when}`;
    }

    case "Send now": {
      return `Sends ${target} now, before its scheduled time`;
    }

    default: {
      return `Sends ${target}`;
    }
  }
};

export const submitNewMessageDelivery = (
  scheduledAt: number | undefined,
  actions: {
    readonly schedule: (scheduledAt: number) => Promise<boolean>;
    readonly send: () => Promise<void>;
  }
) =>
  scheduledAt === undefined ? actions.send() : actions.schedule(scheduledAt);

export const shouldConfirmScheduledEditorClose = (
  isDraftDirty: boolean,
  hasPendingReschedule: boolean
): boolean => isDraftDirty || hasPendingReschedule;
