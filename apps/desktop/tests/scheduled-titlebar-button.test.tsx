import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import TitlebarScheduledButton from "../src/renderer/src/components/shell/titlebar/titlebar-scheduled-button";
import { getHotkeyAriaLabel } from "../src/renderer/src/hotkeys/commands";

describe("Scheduled titlebar attention badge", () => {
  it("hides the badge when no scheduled email needs attention", () => {
    const markup = renderToString(
      <TitlebarScheduledButton
        attentionCount={0}
        isOpen={false}
        onToggle={vi.fn<() => void>()}
      />
    );

    expect(markup).toContain('aria-label="Scheduled"');
    expect(markup).toContain(
      `aria-keyshortcuts="${getHotkeyAriaLabel("app.openScheduled")}"`
    );
    expect(markup).not.toContain("99+");
    expect(markup).not.toContain("need attention");
  });

  it("caps the visual badge while preserving the exact accessible count", () => {
    const markup = renderToString(
      <TitlebarScheduledButton
        attentionCount={137}
        isOpen
        onToggle={vi.fn<() => void>()}
      />
    );

    expect(markup).toContain(
      'aria-label="Scheduled, 137 emails need attention"'
    );
    expect(markup).toContain("99+");
    expect(markup).toContain('aria-pressed="true"');
  });
});
