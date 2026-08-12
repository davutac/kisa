import * as Schema from "effect/Schema";

// oxlint-disable-next-line unicorn/throw-new-error
export class DesktopIpcRegistrationError extends Schema.TaggedError<DesktopIpcRegistrationError>()(
  "DesktopIpcRegistrationError",
  {
    cause: Schema.Defect(),
    channel: Schema.String,
  }
) {
  override get message(): string {
    return `Failed to register the IPC handler for ${this.channel}.`;
  }
}
