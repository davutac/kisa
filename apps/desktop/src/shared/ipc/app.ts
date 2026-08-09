import * as Schema from "effect/Schema";

export const AppClosingEvent = Schema.Literal("closing");

export const AppStartupErrorPayload = Schema.Struct({
  message: Schema.String,
  reason: Schema.optional(Schema.String),
  tag: Schema.optional(Schema.String),
});
export type AppStartupErrorPayload = typeof AppStartupErrorPayload.Type;

export const AppStartupReply = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true) }),
  Schema.Struct({ error: AppStartupErrorPayload, ok: Schema.Literal(false) }),
]);
export type AppStartupReply = typeof AppStartupReply.Type;
