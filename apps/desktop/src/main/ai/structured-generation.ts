import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";

import type { AiModelSelection } from "../../shared/ipc/ai";
import { generateWithClaude } from "./providers/claude";
import { generateWithCodex } from "./providers/codex";
import { generateWithOpenCode } from "./providers/opencode";
import { providerFailure } from "./providers/shared";
import type { StructuredGenerationResult } from "./providers/shared";

export const generateStructuredText = Effect.fn("generateStructuredText")(
  function* generateStructuredText<S extends Schema.Top>(input: {
    readonly model: AiModelSelection;
    readonly outputSchema: S;
    readonly systemPrompt: string;
    readonly userPrompt: string;
  }): StructuredGenerationResult<S> {
    const generationInput = {
      ...input,
      model: input.model.model,
    };
    switch (input.model.provider) {
      case "codex": {
        return yield* generateWithCodex(generationInput);
      }
      case "claude": {
        return yield* generateWithClaude(generationInput);
      }
      case "opencode": {
        return yield* generateWithOpenCode(generationInput);
      }
      default: {
        return yield* providerFailure("codex", "Unsupported AI provider");
      }
    }
  }
);
