import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PageTitlebarContent } from "../src/renderer/src/components/shell/page-titlebar";
import { WindowTitlebar } from "../src/renderer/src/components/shell/window-titlebar";

describe(WindowTitlebar, () => {
  it("clears both sides' window controls unless told it sits beside one", () => {
    expect(renderToString(<WindowTitlebar />)).toBe(
      '<header class="app-titlebar"></header>'
    );
    expect(renderToString(<WindowTitlebar controls="leading" />)).toContain(
      'data-titlebar-inset="leading"'
    );
    expect(renderToString(<WindowTitlebar controls="trailing" />)).toContain(
      'data-titlebar-inset="trailing"'
    );
  });

  it("keeps its content between the controls, as a plain strip when asked", () => {
    expect(
      renderToString(
        <WindowTitlebar as="div" className="flex">
          <span>Kisa</span>
        </WindowTitlebar>
      )
    ).toBe('<div class="app-titlebar flex"><span>Kisa</span></div>');
  });
});

describe(PageTitlebarContent, () => {
  it("puts the title on the leading side and the actions in a no-drag group", () => {
    const markup = renderToString(
      <PageTitlebarContent title="Templates" titleId="templates-title">
        <button type="button">New template</button>
      </PageTitlebarContent>
    );

    expect(markup).toMatch(
      /<h1[^>]*id="templates-title"[^>]*>Templates<\/h1>/u
    );
    expect(markup).toMatch(
      /<div class="app-titlebar-interactive[^"]*"><button type="button">New template<\/button><\/div>/u
    );
  });

  it("leaves the whole strip draggable when the page has no actions", () => {
    const markup = renderToString(<PageTitlebarContent title="Settings" />);

    expect(markup).toContain(">Settings</h1>");
    expect(markup).not.toContain("app-titlebar-interactive");
  });
});
