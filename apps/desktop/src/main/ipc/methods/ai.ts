import * as Schema from "effect/Schema";

import {
  AiCleanupDraftReply,
  AiCleanupDraftRequest,
  AiProviderStatusListReply,
  AiReplyGenerationReply,
  AiReplyRequest,
  AiSettingsReply,
  AiSettingsUpdateRequest,
} from "../../../shared/ipc/ai";
import {
  AI_CLEANUP_DRAFT_CHANNEL,
  AI_GENERATE_REPLY_CHANNEL,
  AI_GET_SETTINGS_CHANNEL,
  AI_LIST_PROVIDERS_CHANNEL,
  AI_UPDATE_SETTINGS_CHANNEL,
} from "../../../shared/ipc/channels";
import { getAiSettings, updateAiSettings } from "../../ai/ai-settings";
import { cleanupAiDraft, generateAiReply } from "../../ai/ai-writing";
import { listAiProviderStatuses } from "../../ai/provider-catalog";
import { makeIpcMethod } from "../desktop-ipc";
import { toIpcReply } from "../reply";

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
    toIpcReply(generateAiReply(request), "Could not generate an email reply"),
  payload: AiReplyRequest,
  result: AiReplyGenerationReply,
});

export const cleanupDraft = makeIpcMethod({
  channel: AI_CLEANUP_DRAFT_CHANNEL,
  handler: (request) =>
    toIpcReply(cleanupAiDraft(request), "Could not clean up the email draft"),
  payload: AiCleanupDraftRequest,
  result: AiCleanupDraftReply,
});
