import * as Schema from "effect/Schema";

// oxlint-disable-next-line unicorn/throw-new-error
export class DesktopIpcUnregistrationError extends Schema.TaggedError<DesktopIpcUnregistrationError>()(
  "DesktopIpcUnregistrationError",
  {
    cause: Schema.Defect(),
    channel: Schema.String,
  }
) {
  override get message(): string {
    return `Failed to unregister the IPC handler for ${this.channel}.`;
  }
}
