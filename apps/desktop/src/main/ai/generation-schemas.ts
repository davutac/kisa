import * as Schema from "effect/Schema";

export const AiCleanupGeneration = Schema.Struct({
  body: Schema.String,
  subject: Schema.String,
});

export const AiCategorizationGeneration = Schema.Struct({
  labelIds: Schema.Array(Schema.String),
});
