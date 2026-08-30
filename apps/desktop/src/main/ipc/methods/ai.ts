import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  AiCleanupDraftReply,
  AiCleanupDraftRequest,
  AiProviderStatusListReply,
  AiReplyGenerationReply,
  AiReplyRequest,
  AiSettingsReply,
  AiSettingsUpdateRequest,
  AiThreadCategorizationReply,
  AiThreadCategorizationRequest,
} from "../../../shared/ipc/ai";
import {
  AI_CATEGORIZE_THREAD_CHANNEL,
  AI_CLEANUP_DRAFT_CHANNEL,
  AI_GENERATE_REPLY_CHANNEL,
  AI_GET_SETTINGS_CHANNEL,
  AI_LIST_PROVIDERS_CHANNEL,
  AI_UPDATE_SETTINGS_CHANNEL,
} from "../../../shared/ipc/channels";
import { getAiSettings, updateAiSettings } from "../../ai/ai-settings";
import { cleanupAiDraft, generateAiReply } from "../../ai/ai-writing";
import { logDevelopmentAiError } from "../../ai/development-logging";
import { listAiProviderStatuses } from "../../ai/provider-catalog";
import { categorizeThread } from "../../ai/thread-categorization";
import { makeIpcMethod } from "../desktop-ipc";
import { toIpcReply } from "../reply";

const withDevelopmentErrorLog = <A, E extends Error, R>(
  operation: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> => {
  const logError = Effect.fn("logDevelopmentAiIpcError")(
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Effect error-channel handler, not a Promise callback
    function* logDevelopmentAiIpcError(error: E) {
      yield* Effect.sync(() => logDevelopmentAiError(operation, error));
    }
  );
  return effect.pipe(Effect.tapError(logError));
};

export const listAiProviders = makeIpcMethod({
  channel: AI_LIST_PROVIDERS_CHANNEL,
  handler: () =>
    toIpcReply(listAiProviderStatuses(), "Could not inspect AI providers"),
  payload: Schema.Void,
  result: AiProviderStatusListReply,
});

export const getAiWritingSettings = makeIpcMethod({
  channel: AI_GET_SETTINGS_CHANNEL,
  handler: () => toIpcReply(getAiSettings(), "Could not load AI settings"),
  payload: Schema.Void,
  result: AiSettingsReply,
});

export const updateAiWritingSettings = makeIpcMethod({
  channel: AI_UPDATE_SETTINGS_CHANNEL,
  handler: (request) =>
    toIpcReply(updateAiSettings(request), "Could not save AI settings"),
  payload: AiSettingsUpdateRequest,
  result: AiSettingsReply,
});

export const generateReply = makeIpcMethod({
  channel: AI_GENERATE_REPLY_CHANNEL,
  handler: (request) =>
    toIpcReply(
      withDevelopmentErrorLog("Reply generation", generateAiReply(request)),
      "Could not generate an email reply"
    ),
  payload: AiReplyRequest,
  result: AiReplyGenerationReply,
});

export const cleanupDraft = makeIpcMethod({
  channel: AI_CLEANUP_DRAFT_CHANNEL,
  handler: (request) =>
    toIpcReply(
      withDevelopmentErrorLog("Draft cleanup", cleanupAiDraft(request)),
      "Could not clean up the email draft"
    ),
  payload: AiCleanupDraftRequest,
  result: AiCleanupDraftReply,
});

export const categorizeMailThread = makeIpcMethod({
  channel: AI_CATEGORIZE_THREAD_CHANNEL,
  handler: (request) =>
    toIpcReply(
      withDevelopmentErrorLog(
        "Thread categorization",
        categorizeThread(request)
      ),
      "Could not categorize this conversation"
    ),
  payload: AiThreadCategorizationRequest,
  result: AiThreadCategorizationReply,
});
