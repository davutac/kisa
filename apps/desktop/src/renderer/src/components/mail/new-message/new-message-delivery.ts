export const getComposerDeliveryLabel = (
  isScheduledEdit: boolean,
  scheduledAt?: number
): "Reschedule" | "Schedule" | "Send" | "Send now" => {
  if (scheduledAt !== undefined) {
    return isScheduledEdit ? "Reschedule" : "Schedule";
  }
  return isScheduledEdit ? "Send now" : "Send";
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
