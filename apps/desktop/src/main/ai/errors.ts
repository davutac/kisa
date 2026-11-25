// oxlint-disable max-classes-per-file unicorn/throw-new-error -- Effect tagged errors are declared as generated classes.
import * as Schema from "effect/Schema";

import { AiProvider } from "../../shared/ipc/ai";

export class AiSettingsError extends Schema.TaggedError<
  AiSettingsError,
  { readonly brand: unique symbol }
>()("AiSettingsError", { message: Schema.String }) {}

export class AiThreadContextError extends Schema.TaggedError<
  AiThreadContextError,
  { readonly brand: unique symbol }
>()("AiThreadContextError", { message: Schema.String }) {}

export class AiModelSelectionError extends Schema.TaggedError<
  AiModelSelectionError,
  { readonly brand: unique symbol }
>()("AiModelSelectionError", { message: Schema.String }) {}

export class AiProviderError extends Schema.TaggedError<
  AiProviderError,
  { readonly brand: unique symbol }
>()("AiProviderError", {
  message: Schema.String,
  provider: AiProvider,
}) {}

export class AiCategorizationError extends Schema.TaggedError<
  AiCategorizationError,
  { readonly brand: unique symbol }
>()("AiCategorizationError", { message: Schema.String }) {}
