import { describe, expect, it } from "vitest";

import {
  getAiModelSelection,
  getAvailableAiModelSelection,
} from "../src/renderer/src/ai";
import type {
  AiModelSelection,
  AiProviderStatus,
  AiSettings,
} from "../src/shared/ipc/ai";

const settings = {
  activeProvider: "codex",
  cleanupUserInstructions: "Clean up drafts",
  providerModels: {
    claude: "claude-sonnet-5",
    codex: "gpt-5.6-luna",
    opencode: null,
  },
  providerReasoning: { claude: null, codex: "low", opencode: null },
  replyUserInstructions: "Write replies",
} satisfies AiSettings;

const selection = {
  model: "gpt-5.6-luna",
  provider: "codex",
  reasoning: "low",
} satisfies AiModelSelection;

const codex = {
  authentication: "authenticated",
  installed: true,
  models: [
    {
      id: "gpt-5.6-luna",
      isDefault: true,
      name: "GPT-5.6 Luna",
      reasoningOptions: [{ id: "low" }, { id: "medium", isDefault: true }],
    },
  ],
  provider: "codex",
} satisfies AiProviderStatus;

describe("AI model selection", () => {
  it("resolves the active provider and model", () => {
    expect(getAiModelSelection(settings)).toStrictEqual({
      model: "gpt-5.6-luna",
      provider: "codex",
      reasoning: "low",
    });
  });

  it("requires an active provider with a configured model", () => {
    expect(
      getAiModelSelection({ ...settings, activeProvider: null })
    ).toBeNull();
    expect(
      getAiModelSelection({ ...settings, activeProvider: "opencode" })
    ).toBeNull();
  });

  it("resolves an available active provider and model", () => {
    expect(getAvailableAiModelSelection(selection, [codex])).toStrictEqual(
      selection
    );
  });

  it("rejects a configured provider that is not available", () => {
    expect(getAvailableAiModelSelection(selection, [])).toBeNull();
    expect(
      getAvailableAiModelSelection(selection, [{ ...codex, installed: false }])
    ).toBeNull();
    expect(
      getAvailableAiModelSelection(
        { ...selection, model: "model-not-reported" },
        [codex]
      )
    ).toBeNull();
  });

  it("repairs missing or stale reasoning with the model's real default", () => {
    expect(
      getAvailableAiModelSelection({ ...selection, reasoning: "max" }, [codex])
    ).toStrictEqual({ ...selection, reasoning: "medium" });
    expect(
      getAvailableAiModelSelection(
        { model: selection.model, provider: selection.provider },
        [codex]
      )
    ).toStrictEqual({ ...selection, reasoning: "medium" });
  });

  it("drops stale reasoning when the model has no reasoning choices", () => {
    expect(
      getAvailableAiModelSelection(selection, [
        {
          ...codex,
          models: [{ ...codex.models[0], reasoningOptions: [] }],
        },
      ])
    ).toStrictEqual({ model: selection.model, provider: selection.provider });
  });
});
