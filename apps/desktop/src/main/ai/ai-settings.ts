import { aiSettings } from "@repo/database/schemas";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  AiProvider,
  DEFAULT_AI_PROVIDER_MODELS,
  DEFAULT_AI_PROVIDER_REASONING,
} from "../../shared/ipc/ai";
import type { AiSettings, AiSettingsUpdateRequest } from "../../shared/ipc/ai";
import { withDatabaseClient } from "../database";
import { AiSettingsError } from "./errors";

const AI_SETTINGS_ROW_ID = 1;

const decodeProvider = Schema.decodeUnknownOption(AiProvider);

const toAiSettings = (row: {
  readonly activeProvider: string | null;
  readonly claudeModel: string;
  readonly claudeReasoning: string | null;
  readonly cleanupUserInstructions: string;
  readonly codexModel: string;
  readonly codexReasoning: string | null;
  readonly openCodeModel: string | null;
  readonly openCodeReasoning: string | null;
  readonly replyUserInstructions: string;
}): AiSettings => ({
  activeProvider: Option.getOrNull(decodeProvider(row.activeProvider)),
  cleanupUserInstructions: row.cleanupUserInstructions,
  providerModels: {
    claude: row.claudeModel || DEFAULT_AI_PROVIDER_MODELS.claude,
    codex: row.codexModel || DEFAULT_AI_PROVIDER_MODELS.codex,
    opencode: row.openCodeModel,
  },
  providerReasoning: {
    claude: row.claudeReasoning,
    codex: row.codexReasoning,
    opencode: row.openCodeReasoning,
  },
  replyUserInstructions: row.replyUserInstructions,
});

export const getAiSettings = Effect.fn("getAiSettings")(
  function* getAiSettings() {
    const row = yield* withDatabaseClient((database) =>
      database.query.aiSettings.findFirst({
        where: { id: AI_SETTINGS_ROW_ID },
      })
    ).pipe(
      Effect.mapError(
        () => new AiSettingsError({ message: "Could not load AI settings" })
      )
    );

    return row === undefined
      ? {
          activeProvider: null,
          cleanupUserInstructions: "",
          providerModels: DEFAULT_AI_PROVIDER_MODELS,
          providerReasoning: DEFAULT_AI_PROVIDER_REASONING,
          replyUserInstructions: "",
        }
      : toAiSettings(row);
  }
);

export const updateAiSettings = Effect.fn("updateAiSettings")(
  function* updateAiSettings(request: AiSettingsUpdateRequest) {
    const now = Date.now();

    yield* withDatabaseClient((database) =>
      database
        .insert(aiSettings)
        .values({
          activeProvider: request.activeProvider,
          claudeModel: request.providerModels.claude,
          claudeReasoning: request.providerReasoning.claude,
          cleanupUserInstructions: request.cleanupUserInstructions,
          codexModel: request.providerModels.codex,
          codexReasoning: request.providerReasoning.codex,
          id: AI_SETTINGS_ROW_ID,
          openCodeModel: request.providerModels.opencode,
          openCodeReasoning: request.providerReasoning.opencode,
          replyUserInstructions: request.replyUserInstructions,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          set: {
            activeProvider: request.activeProvider,
            claudeModel: request.providerModels.claude,
            claudeReasoning: request.providerReasoning.claude,
            cleanupUserInstructions: request.cleanupUserInstructions,
            codexModel: request.providerModels.codex,
            codexReasoning: request.providerReasoning.codex,
            openCodeModel: request.providerModels.opencode,
            openCodeReasoning: request.providerReasoning.opencode,
            replyUserInstructions: request.replyUserInstructions,
            updatedAt: now,
          },
          target: aiSettings.id,
        })
        .run()
    ).pipe(
      Effect.mapError(
        () => new AiSettingsError({ message: "Could not save AI settings" })
      )
    );

    return yield* getAiSettings();
  }
);
