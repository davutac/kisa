import * as Schema from "effect/Schema";

import { MAX_GMAIL_SUBJECT_LENGTH } from "../gmail-subject";
import { IpcReply } from "./reply";

export const AiProvider = Schema.Literals(["codex", "claude", "opencode"]);
export type AiProvider = typeof AiProvider.Type;

export const AiModelSelection = Schema.Struct({
  model: Schema.NonEmptyString,
  provider: AiProvider,
});
export type AiModelSelection = typeof AiModelSelection.Type;

export const AiProviderModels = Schema.Struct({
  claude: Schema.NonEmptyString,
  codex: Schema.NonEmptyString,
  opencode: Schema.NullOr(Schema.NonEmptyString),
});
export type AiProviderModels = typeof AiProviderModels.Type;

export const DEFAULT_AI_PROVIDER_MODELS = {
  claude: "claude-sonnet-5",
  codex: "gpt-5.6-luna",
  opencode: null,
} as const satisfies AiProviderModels;

export const AiModel = Schema.Struct({
  id: Schema.NonEmptyString,
  isDefault: Schema.Boolean,
  name: Schema.NonEmptyString,
});
export type AiModel = typeof AiModel.Type;

export const AiAuthenticationStatus = Schema.Literals([
  "authenticated",
  "unauthenticated",
  "unknown",
]);
export type AiAuthenticationStatus = typeof AiAuthenticationStatus.Type;

export const AiProviderStatus = Schema.Struct({
  authEmail: Schema.optional(Schema.String),
  authLabel: Schema.optional(Schema.String),
  authentication: AiAuthenticationStatus,
  error: Schema.optional(Schema.String),
  installed: Schema.Boolean,
  message: Schema.optional(Schema.String),
  models: Schema.Array(AiModel),
  provider: AiProvider,
  version: Schema.optional(Schema.String),
});
export type AiProviderStatus = typeof AiProviderStatus.Type;

export const AiProviderStatusListReply = IpcReply(
  Schema.Array(AiProviderStatus)
);
export type AiProviderStatusListReply = typeof AiProviderStatusListReply.Type;

export const MAX_AI_INSTRUCTIONS_LENGTH = 10_000;
export const MAX_AI_OPERATION_INSTRUCTIONS_LENGTH = 4000;
export const MAX_AI_DRAFT_BODY_LENGTH = 200_000;

const AiInstructions = Schema.NonEmptyString.check(
  Schema.isMaxLength(MAX_AI_INSTRUCTIONS_LENGTH)
);

export const AiSettings = Schema.Struct({
  activeProvider: Schema.NullOr(AiProvider),
  cleanupInstructions: AiInstructions,
  providerModels: AiProviderModels,
  replyInstructions: AiInstructions,
});
export type AiSettings = typeof AiSettings.Type;

export const AiSettingsUpdateRequest = AiSettings;
export type AiSettingsUpdateRequest = typeof AiSettingsUpdateRequest.Type;

export const AiSettingsReply = IpcReply(AiSettings);
export type AiSettingsReply = typeof AiSettingsReply.Type;

const OperationInstructions = Schema.optional(
  Schema.String.check(Schema.isMaxLength(MAX_AI_OPERATION_INSTRUCTIONS_LENGTH))
);

export const AiReplyRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  instructions: OperationInstructions,
  model: Schema.optional(AiModelSelection),
  threadId: Schema.NonEmptyString,
});
export type AiReplyRequest = typeof AiReplyRequest.Type;

export const AiReply = Schema.Struct({ body: Schema.String });
export type AiReply = typeof AiReply.Type;

export const AiReplyGenerationReply = IpcReply(AiReply);
export type AiReplyGenerationReply = typeof AiReplyGenerationReply.Type;

export const AiCleanupDraftRequest = Schema.Struct({
  body: Schema.String.check(Schema.isMaxLength(MAX_AI_DRAFT_BODY_LENGTH)),
  instructions: OperationInstructions,
  model: Schema.optional(AiModelSelection),
  subject: Schema.String.check(Schema.isMaxLength(MAX_GMAIL_SUBJECT_LENGTH)),
});
export type AiCleanupDraftRequest = typeof AiCleanupDraftRequest.Type;

export const AiCleanedDraft = Schema.Struct({
  body: Schema.String,
  subject: Schema.String.check(Schema.isMaxLength(MAX_GMAIL_SUBJECT_LENGTH)),
});
export type AiCleanedDraft = typeof AiCleanedDraft.Type;

export const AiCleanupDraftReply = IpcReply(AiCleanedDraft);
export type AiCleanupDraftReply = typeof AiCleanupDraftReply.Type;
