import * as Effect from "effect/Effect";

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
  BASE_AI_SYSTEM_INSTRUCTIONS,
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
    const model =
      requestModel ??
      (settings.activeProvider === null || configuredModel === null
        ? null
        : { model: configuredModel, provider: settings.activeProvider });
    if (model === null) {
      return yield* new AiModelSelectionError({
        message: "Choose an AI model before generating email text",
      });
    }
    const operationInstructions =
      operation === "reply"
        ? settings.replyInstructions
        : settings.cleanupInstructions;
    return {
      model,
      systemPrompt: `${BASE_AI_SYSTEM_INSTRUCTIONS}\n\nWriting task instructions:\n${operationInstructions}`,
    };
  }
);

const sanitizeSubject = (subject: string): string =>
  (subject.trim().split(/\r?\n/gu)[0] ?? "")
    .trim()
    .slice(0, MAX_GMAIL_SUBJECT_LENGTH);

export const generateAiReply = Effect.fn("generateAiReply")(
  function* generateAiReply(request: AiReplyRequest) {
    const [generation, context] = yield* Effect.all(
      [
        loadGenerationSettings(request.model, "reply"),
        loadAiThreadContext(request),
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
        instructions: request.instructions,
      }),
    }).pipe(Effect.scoped);

    return { body: generated.body.trim() };
  }
);

export const cleanupAiDraft = Effect.fn("cleanupAiDraft")(
  function* cleanupAiDraft(request: AiCleanupDraftRequest) {
    const generation = yield* loadGenerationSettings(request.model, "cleanup");
    const generated = yield* generateStructuredText({
      model: generation.model,
      outputSchema: AiCleanupGeneration,
      systemPrompt: generation.systemPrompt,
      userPrompt: buildCleanupPrompt(request),
    }).pipe(Effect.scoped);

    return {
      body: generated.body.trim(),
      subject: sanitizeSubject(generated.subject),
    };
  }
);
