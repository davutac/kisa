import { describe, expect, it } from "vitest";

import {
  areAiProviderModelsEqual,
  getAiProviderModelOptions,
  getAiProviderPresentation,
  groupOpenCodeModelOptions,
} from "../src/renderer/src/routes/settings/-components/ai-settings-view";
import type { AiProviderStatus } from "../src/shared/ipc/ai";

const codex = {
  authEmail: "person@example.com",
  authLabel: "ChatGPT Pro 5x Subscription",
  authentication: "authenticated",
  installed: true,
  models: [{ id: "gpt-5", isDefault: true, name: "GPT-5" }],
  provider: "codex",
  version: "0.147.0",
} satisfies AiProviderStatus;

describe("AI settings view", () => {
  it("presents provider-specific model choices", () => {
    expect(getAiProviderModelOptions(codex)).toStrictEqual([
      { label: "GPT-5", model: "gpt-5" },
    ]);
  });

  it("groups OpenCode models by their upstream provider", () => {
    expect(
      groupOpenCodeModelOptions([
        { label: "Claude Sonnet", model: "anthropic/claude-sonnet" },
        { label: "GPT", model: "openai/gpt" },
        { label: "Claude Opus", model: "anthropic/claude-opus" },
      ])
    ).toStrictEqual([
      {
        items: [
          { label: "Claude Sonnet", model: "anthropic/claude-sonnet" },
          { label: "Claude Opus", model: "anthropic/claude-opus" },
        ],
        label: "Anthropic",
      },
      {
        items: [{ label: "GPT", model: "openai/gpt" }],
        label: "OpenAI",
      },
    ]);
  });

  it("compares the saved model for every provider", () => {
    expect(
      areAiProviderModelsEqual(
        { claude: "sonnet", codex: "gpt", opencode: "openai/gpt" },
        { claude: "sonnet", codex: "gpt", opencode: "openai/gpt" }
      )
    ).toBeTruthy();
    expect(
      areAiProviderModelsEqual(
        { claude: "sonnet", codex: "gpt", opencode: "openai/gpt" },
        { claude: "opus", codex: "gpt", opencode: "openai/gpt" }
      )
    ).toBeFalsy();
  });

  it("uses T3 Code-style provider status language", () => {
    expect(getAiProviderPresentation(codex)).toMatchObject({
      detail: "ChatGPT Pro 5x Subscription",
      headline: "Authenticated as person@example.com",
    });
    expect(
      getAiProviderPresentation({
        authentication: "unknown",
        installed: false,
        models: [],
        provider: "opencode",
      })
    ).toMatchObject({
      detail: "CLI not detected on PATH.",
      headline: "Not found",
    });
  });
});
