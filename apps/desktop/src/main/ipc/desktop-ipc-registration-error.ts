import * as Schema from "effect/Schema";

export class DesktopIpcRegistrationError extends Schema.TaggedErrorClass<DesktopIpcRegistrationError>()(
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
