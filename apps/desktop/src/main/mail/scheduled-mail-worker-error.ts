import { Schema } from "effect";

// oxlint-disable-next-line unicorn/throw-new-error -- Effect Schema tagged errors are declared as generated classes.
export class ScheduledMailWorkerError extends Schema.TaggedError<ScheduledMailWorkerError>()(
  "ScheduledMailWorkerError",
  { message: Schema.String }
) {}

export const scheduledMailWorkerError = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Promise rejection values are unknown at worker adapter boundaries.
  error: unknown
): ScheduledMailWorkerError =>
  new ScheduledMailWorkerError({
    message:
      error instanceof Error
        ? error.message
        : "Scheduled mail operation failed",
  });
