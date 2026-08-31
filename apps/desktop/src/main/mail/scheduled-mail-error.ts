import { Schema } from "effect";

// oxlint-disable-next-line unicorn/throw-new-error -- Effect Schema tagged errors are declared as generated classes.
export class ScheduledMailError extends Schema.TaggedError<ScheduledMailError>()(
  "ScheduledMailError",
  { message: Schema.String }
) {}

export const scheduledMailError = (message: string): ScheduledMailError =>
  new ScheduledMailError({ message });
