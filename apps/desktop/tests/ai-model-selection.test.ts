import { describe, expect, it } from "vitest";

import { getAiModelSelection } from "../src/renderer/src/ai";

const settings = {
  activeProvider: "codex",
  cleanupUserInstructions: "Clean up drafts",
  providerModels: {
    claude: "claude-sonnet-5",
    codex: "gpt-5.6-luna",
    opencode: null,
  },
  replyUserInstructions: "Write replies",
} as const;

describe("AI model selection", () => {
  it("resolves the active provider and model", () => {
    expect(getAiModelSelection(settings)).toStrictEqual({
      model: "gpt-5.6-luna",
      provider: "codex",
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
});
