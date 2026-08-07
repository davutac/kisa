import * as Schema from "effect/Schema";

export class DesktopIpcUnregistrationError extends Schema.TaggedErrorClass<DesktopIpcUnregistrationError>()(
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
