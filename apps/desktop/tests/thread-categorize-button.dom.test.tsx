import { act, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { settle } from "@ui-sdk/core/testing";
import { describe, expect, it, vi } from "vitest";

import ThreadCategorizeButton from "../src/renderer/src/components/mail/thread-categorize-button";
import type { AiApi } from "../src/renderer/src/platform/desktop";
import { AiProviderStateProvider } from "../src/renderer/src/state/ai-provider-state";

const categorizeThread = vi.hoisted(() => vi.fn<AiApi["categorizeThread"]>());

// With no answer from main, no model is chosen, so categorizing is unavailable.
vi.mock(import("@/platform/desktop"), async (importOriginal) => ({
  ...(await importOriginal()),
  getAiApi: () =>
    new Proxy<Partial<AiApi>>(
      { categorizeThread },
      {
        get: (target, key) => {
          if (key in target) {
            return Reflect.get(target, key);
          }
          return String(key).startsWith("on")
            ? () => () => {}
            : () => Promise.resolve({ error: "Unavailable", ok: false });
        },
      }
    ) as AiApi,
}));

describe(ThreadCategorizeButton, () => {
  it("keeps the unavailable button reachable, so its tooltip can say why", async () => {
    const user = userEvent.setup();
    render(
      <AiProviderStateProvider>
        <ThreadCategorizeButton accountId="one@example.com" threadId="t1" />
      </AiProviderStateProvider>
    );
    await act(settle);
    const button = screen.getByRole("button", {
      name: /^Categorize with AI unavailable/u,
    });

    await user.tab();
    const focused = document.activeElement;
    await user.keyboard("{Enter}");
    await user.click(button);

    expect(focused).toBe(button);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.parentElement?.tagName).not.toBe("SPAN");
    expect(categorizeThread).not.toHaveBeenCalled();
  });
});
