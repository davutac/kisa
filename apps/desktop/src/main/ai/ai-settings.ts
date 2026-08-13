import { aiSettings } from "@repo/database/schemas";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { AiProvider, DEFAULT_AI_PROVIDER_MODELS } from "../../shared/ipc/ai";
import type { AiSettings, AiSettingsUpdateRequest } from "../../shared/ipc/ai";
import { withDatabaseClient } from "../database";
import { AiSettingsError } from "./errors";

const AI_SETTINGS_ROW_ID = 1;

const decodeProvider = Schema.decodeUnknownOption(AiProvider);

const toAiSettings = (row: {
  readonly activeProvider: string | null;
  readonly claudeModel: string;
  readonly cleanupUserInstructions: string;
  readonly codexModel: string;
  readonly openCodeModel: string | null;
  readonly replyUserInstructions: string;
}): AiSettings => ({
  activeProvider: Option.getOrNull(decodeProvider(row.activeProvider)),
  cleanupUserInstructions: row.cleanupUserInstructions,
  providerModels: {
    claude: row.claudeModel || DEFAULT_AI_PROVIDER_MODELS.claude,
    codex: row.codexModel || DEFAULT_AI_PROVIDER_MODELS.codex,
    opencode: row.openCodeModel,
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
          cleanupUserInstructions: request.cleanupUserInstructions,
          codexModel: request.providerModels.codex,
          id: AI_SETTINGS_ROW_ID,
          openCodeModel: request.providerModels.opencode,
          replyUserInstructions: request.replyUserInstructions,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          set: {
            activeProvider: request.activeProvider,
            claudeModel: request.providerModels.claude,
            cleanupUserInstructions: request.cleanupUserInstructions,
            codexModel: request.providerModels.codex,
            openCodeModel: request.providerModels.opencode,
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
