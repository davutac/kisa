import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import {
  DEFAULT_AI_DRAFT_CLEANUP_USER_INSTRUCTIONS,
  DEFAULT_AI_REPLY_USER_INSTRUCTIONS,
} from "../../shared/ai-instructions";
import { MAX_GMAIL_SUBJECT_LENGTH } from "../../shared/gmail-subject";
import { AiReply } from "../../shared/ipc/ai";
import type {
  AiCleanupDraftRequest,
  AiModelSelection,
  AiReplyRequest,
} from "../../shared/ipc/ai";
import { getAiSettings } from "./ai-settings";
import { AiModelSelectionError } from "./errors";
import { AiCleanupGeneration } from "./generation-schemas";
import {
  AI_DRAFT_CLEANUP_SYSTEM_INSTRUCTIONS,
  AI_REPLY_SYSTEM_INSTRUCTIONS,
  buildCleanupPrompt,
  buildReplyPrompt,
} from "./prompts";
import { generateStructuredText } from "./structured-generation";
import { loadAiThreadContext } from "./thread-context";

const loadGenerationSettings = Effect.fn("loadAiGenerationSettings")(
  function* loadGenerationSettings(
    requestModel: AiModelSelection | undefined,
    operation: "cleanup" | "reply"
  ) {
    const settings = yield* getAiSettings();
    const configuredModel =
      settings.activeProvider === null
        ? null
        : settings.providerModels[settings.activeProvider];
    const configuredReasoning =
      settings.activeProvider === null
        ? null
        : settings.providerReasoning[settings.activeProvider];
    const model =
      requestModel ??
      (settings.activeProvider === null || configuredModel === null
        ? null
        : {
            model: configuredModel,
            provider: settings.activeProvider,
            reasoning: configuredReasoning ?? undefined,
          });
    if (model === null) {
      return yield* new AiModelSelectionError({
        message: "Choose an AI model before generating email text",
      });
    }
    const instructions =
      operation === "reply"
        ? {
            standingInstructions:
              settings.replyUserInstructions.trim() ||
              DEFAULT_AI_REPLY_USER_INSTRUCTIONS,
            systemPrompt: AI_REPLY_SYSTEM_INSTRUCTIONS,
          }
        : {
            standingInstructions:
              settings.cleanupUserInstructions.trim() ||
              DEFAULT_AI_DRAFT_CLEANUP_USER_INSTRUCTIONS,
            systemPrompt: AI_DRAFT_CLEANUP_SYSTEM_INSTRUCTIONS,
          };
    return {
      ...instructions,
      model,
    };
  }
);

const loadAiRuntimeContext = Effect.fn("loadAiRuntimeContext")(
  function* loadAiRuntimeContext() {
    const now = yield* DateTime.nowInCurrentZone.pipe(
      Effect.provide(DateTime.layerCurrentZoneLocal)
    );
    return {
      currentDate: DateTime.formatIsoDate(now),
      deviceTimeZone: DateTime.zoneToString(now.zone),
    };
  }
);

const sanitizeSubject = (subject: string): string =>
  (subject.trim().split(/\r?\n/gu)[0] ?? "")
    .trim()
    .slice(0, MAX_GMAIL_SUBJECT_LENGTH);

export const generateAiReply = Effect.fn("generateAiReply")(
  function* generateAiReply(request: AiReplyRequest) {
    const [generation, context, runtimeContext] = yield* Effect.all(
      [
        loadGenerationSettings(request.model, "reply"),
        loadAiThreadContext(request),
        loadAiRuntimeContext(),
      ],
      { concurrency: "unbounded" }
    );
    const generated = yield* generateStructuredText({
      model: generation.model,
      outputSchema: AiReply,
      systemPrompt: generation.systemPrompt,
      userPrompt: buildReplyPrompt({
        accountId: request.accountId,
        context,
        requestInstructions: request.instructions,
        runtimeContext,
        standingInstructions: generation.standingInstructions,
      }),
    }).pipe(Effect.scoped);

    return { body: generated.body.trim() };
  }
);

export const cleanupAiDraft = Effect.fn("cleanupAiDraft")(
  function* cleanupAiDraft(request: AiCleanupDraftRequest) {
    const [generation, runtimeContext] = yield* Effect.all(
      [
        loadGenerationSettings(request.model, "cleanup"),
        loadAiRuntimeContext(),
      ],
      { concurrency: "unbounded" }
    );
    const generated = yield* generateStructuredText({
      model: generation.model,
      outputSchema: AiCleanupGeneration,
      systemPrompt: generation.systemPrompt,
      userPrompt: buildCleanupPrompt({
        body: request.body,
        requestInstructions: request.instructions,
        runtimeContext,
        standingInstructions: generation.standingInstructions,
        subject: request.subject,
      }),
    }).pipe(Effect.scoped);

    return {
      body: generated.body.trim(),
      subject: sanitizeSubject(generated.subject),
    };
  }
);
