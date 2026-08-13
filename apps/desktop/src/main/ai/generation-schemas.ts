import * as Schema from "effect/Schema";

export const AiCleanupGeneration = Schema.Struct({
  body: Schema.String,
  subject: Schema.String,
});
