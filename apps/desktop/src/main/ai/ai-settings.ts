import { aiSettings } from "@repo/database/schemas";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { AiProvider, DEFAULT_AI_PROVIDER_MODELS } from "../../shared/ipc/ai";
import type { AiSettings, AiSettingsUpdateRequest } from "../../shared/ipc/ai";
import { withDatabaseClient } from "../database";
import { AiSettingsError } from "./errors";
import {
  DEFAULT_AI_CLEANUP_INSTRUCTIONS,
  DEFAULT_AI_REPLY_INSTRUCTIONS,
} from "./prompts";

const AI_SETTINGS_ROW_ID = 1;

const decodeProvider = Schema.decodeUnknownOption(AiProvider);

const toAiSettings = (row: {
  readonly activeProvider: string | null;
  readonly claudeModel: string;
  readonly cleanupInstructions: string;
  readonly codexModel: string;
  readonly openCodeModel: string | null;
  readonly replyInstructions: string;
}): AiSettings => ({
  activeProvider: Option.getOrNull(decodeProvider(row.activeProvider)),
  cleanupInstructions:
    row.cleanupInstructions || DEFAULT_AI_CLEANUP_INSTRUCTIONS,
  providerModels: {
    claude: row.claudeModel || DEFAULT_AI_PROVIDER_MODELS.claude,
    codex: row.codexModel || DEFAULT_AI_PROVIDER_MODELS.codex,
    opencode: row.openCodeModel,
  },
  replyInstructions: row.replyInstructions || DEFAULT_AI_REPLY_INSTRUCTIONS,
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
          cleanupInstructions: DEFAULT_AI_CLEANUP_INSTRUCTIONS,
          providerModels: DEFAULT_AI_PROVIDER_MODELS,
          replyInstructions: DEFAULT_AI_REPLY_INSTRUCTIONS,
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
          cleanupInstructions: request.cleanupInstructions,
          codexModel: request.providerModels.codex,
          id: AI_SETTINGS_ROW_ID,
          openCodeModel: request.providerModels.opencode,
          replyInstructions: request.replyInstructions,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          set: {
            activeProvider: request.activeProvider,
            claudeModel: request.providerModels.claude,
            cleanupInstructions: request.cleanupInstructions,
            codexModel: request.providerModels.codex,
            openCodeModel: request.providerModels.opencode,
            replyInstructions: request.replyInstructions,
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
