import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RadioGroup } from "../src/renderer/src/components/ui/radio-group";
import AiProviderRow from "../src/renderer/src/routes/settings/-components/ai-provider-row";
import type { AiProviderStatus } from "../src/shared/ipc/ai";

const status = {
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

describe("AI provider settings row", () => {
  it("renders model and reasoning controls inside their required contexts", () => {
    const markup = renderToString(
      <RadioGroup value="codex">
        <AiProviderRow
          activeProvider="codex"
          currentModel="gpt-5.6-luna"
          currentReasoning="low"
          isLoading={false}
          onSelectModel={() => null}
          onSelectReasoning={() => null}
          provider="codex"
          status={status}
        />
      </RadioGroup>
    );

    expect(markup).toContain("GPT-5.6 Luna");
    expect(markup).toContain("Low");
    expect(markup).toContain("Codex reasoning, Low");
    expect(markup).not.toContain("Default (Medium)");
  });

  it("hides reasoning when the selected model has no reasoning options", () => {
    const markup = renderToString(
      <RadioGroup value="codex">
        <AiProviderRow
          activeProvider="codex"
          currentModel="gpt-5.6-luna"
          currentReasoning={null}
          isLoading={false}
          onSelectModel={() => null}
          onSelectReasoning={() => null}
          provider="codex"
          status={{
            ...status,
            models: [{ ...status.models[0], reasoningOptions: [] }],
          }}
        />
      </RadioGroup>
    );

    expect(markup).toContain("Codex model, GPT-5.6 Luna");
    expect(markup).not.toContain("Codex reasoning");
  });

  it("uses the model-owned label and choice names for non-effort options", () => {
    const markup = renderToString(
      <RadioGroup value="claude">
        <AiProviderRow
          activeProvider="claude"
          currentModel="claude-haiku-4-5"
          currentReasoning="enabled"
          isLoading={false}
          onSelectModel={() => null}
          onSelectReasoning={() => null}
          provider="claude"
          status={{
            authentication: "authenticated",
            installed: true,
            models: [
              {
                id: "claude-haiku-4-5",
                isDefault: false,
                name: "Haiku 4.5",
                optionLabel: "Thinking",
                reasoningOptions: [
                  { id: "disabled", isDefault: true, label: "Off" },
                  { id: "enabled", label: "On" },
                ],
              },
            ],
            provider: "claude",
          }}
        />
      </RadioGroup>
    );

    expect(markup).toContain("Claude thinking, On");
  });
});
