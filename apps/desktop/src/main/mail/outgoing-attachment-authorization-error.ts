import { Schema } from "effect";

// oxlint-disable-next-line unicorn/throw-new-error
export class OutgoingAttachmentAuthorizationError extends Schema.TaggedErrorClass<OutgoingAttachmentAuthorizationError>()(
  "OutgoingAttachmentAuthorizationError",
  { message: Schema.String }
) {}
