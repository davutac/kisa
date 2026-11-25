import { Schema } from "effect";

// oxlint-disable-next-line unicorn/throw-new-error
export class OutgoingAttachmentAuthorizationError extends Schema.TaggedError<
  OutgoingAttachmentAuthorizationError,
  { readonly brand: unique symbol }
>()("OutgoingAttachmentAuthorizationError", { message: Schema.String }) {}
