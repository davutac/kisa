import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import SidebarScheduledRow from "../src/renderer/src/components/shell/sidebar/sidebar-scheduled-row";
import { getHotkeyAriaLabel } from "../src/renderer/src/hotkeys/commands";

describe("Scheduled sidebar attention badge", () => {
  it("hides the badge when no scheduled email needs attention", () => {
    const markup = renderToString(
      <SidebarScheduledRow
        attentionCount={0}
        isCurrent={false}
        onSelect={vi.fn<() => void>()}
      />
    );

    expect(markup).toContain('aria-label="Scheduled"');
    expect(markup).toContain(
      `aria-keyshortcuts="${getHotkeyAriaLabel("app.openScheduled")}"`
    );
    expect(markup).not.toContain("aria-current");
    expect(markup).not.toContain("99+");
    expect(markup).not.toContain("need attention");
  });

  it("caps the visual badge while preserving the exact accessible count", () => {
    const markup = renderToString(
      <SidebarScheduledRow
        attentionCount={137}
        isCurrent
        onSelect={vi.fn<() => void>()}
      />
    );

    expect(markup).toContain(
      'aria-label="Scheduled, 137 emails need attention"'
    );
    expect(markup).toContain("99+");
    expect(markup).toContain('aria-current="page"');
  });
});
