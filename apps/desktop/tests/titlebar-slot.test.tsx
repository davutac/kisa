import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TitlebarSlot } from "../src/renderer/src/components/shell/titlebar-slot";

describe(TitlebarSlot, () => {
  it("renders nothing outside the main window's shell", () => {
    expect(
      renderToString(
        <TitlebarSlot>
          <nav aria-label="Mailbox labels" />
        </TitlebarSlot>
      )
    ).toBe("");
  });
});
