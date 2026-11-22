import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SidebarRow } from "../src/renderer/src/components/shell/sidebar/sidebar-row";

const renderRow = (command?: "app.openAccount1" | "app.toggleSpam"): string =>
  renderToString(
    <SidebarRow
      command={command}
      isCurrent={false}
      label="one@example.com"
      onSelect={vi.fn<() => void>()}
      trailing={<span data-testid="trailing" />}
    />
  );

describe(SidebarRow, () => {
  it("keeps its shortcut hidden until a held Mod reveals it in the trailing slot", () => {
    const markup = renderRow("app.openAccount1");

    expect(markup).toMatch(
      /<span class="contents in-data-\[hotkey-hints\]:hidden"><span data-testid="trailing">/u
    );
    const hint = markup.match(/<kbd data-slot="kbd-group"[^>]*>/u)?.[0] ?? "";

    expect(hint).toContain('aria-hidden="true"');
    expect(hint).toMatch(/\bhidden in-data-\[hotkey-hints\]:inline-flex\b/u);
    expect(hint).not.toMatch(/(?:^|\s)inline-flex\b/u);
  });

  it.each([
    ["without a shortcut", undefined],
    // Under a held Mod, a plain `S` would be pressed as `Mod+S`.
    ["for a plain-key shortcut", "app.toggleSpam"],
  ] as const)("shows its trailing content as is %s", (_case, command) => {
    const markup = renderRow(command);

    expect(markup).not.toContain("hotkey-hints");
    expect(markup).not.toContain("<kbd");
    expect(markup).toContain('<span data-testid="trailing">');
  });
});
