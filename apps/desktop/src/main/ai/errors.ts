import * as Schema from "effect/Schema";

import { AiProvider } from "../../shared/ipc/ai";

// oxlint-disable max-classes-per-file unicorn/throw-new-error

export class AiSettingsError extends Schema.TaggedError<AiSettingsError>()(
  "AiSettingsError",
  { message: Schema.String }
) {}

export class AiThreadContextError extends Schema.TaggedError<AiThreadContextError>()(
  "AiThreadContextError",
  { message: Schema.String }
) {}

export class AiModelSelectionError extends Schema.TaggedError<AiModelSelectionError>()(
  "AiModelSelectionError",
  { message: Schema.String }
) {}

export class AiProviderError extends Schema.TaggedError<AiProviderError>()(
  "AiProviderError",
  {
    message: Schema.String,
    provider: AiProvider,
  }
) {}

export class AiCategorizationError extends Schema.TaggedError<AiCategorizationError>()(
  "AiCategorizationError",
  { message: Schema.String }
) {}
