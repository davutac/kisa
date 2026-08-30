import * as Effect from "effect/Effect";

import type { AiModelSelection, AiSettings } from "../../shared/ipc/ai";
import { AiModelSelectionError } from "./errors";

export const requireAiModelSelection = Effect.fnUntraced(
  function* requireAiModelSelection(
    settings: AiSettings,
    requested?: AiModelSelection
  ) {
    if (requested !== undefined) {
      return requested;
    }

    const provider = settings.activeProvider;
    const model = provider === null ? null : settings.providerModels[provider];
    if (provider === null || model === null) {
      return yield* new AiModelSelectionError({
        message: "Choose an AI model before using AI features",
      });
    }

    const reasoning = settings.providerReasoning[provider];
    return {
      model,
      provider,
      reasoning: reasoning ?? undefined,
    } satisfies AiModelSelection;
  }
);
