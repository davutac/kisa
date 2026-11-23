import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { DATABASE_IMPORT_OVERLAY_CLASS_NAME } from "../src/renderer/src/components/settings/settings-database-import-dialog";
import { DialogContent } from "../src/renderer/src/components/ui/dialog";

describe("database import overlay", () => {
  it("removes the dialog width cap at desktop breakpoints", () => {
    const portal = DialogContent({
      children: null,
      className: DATABASE_IMPORT_OVERLAY_CLASS_NAME,
      showCloseButton: false,
    }) as ReactElement<{ children: ReactElement[] }>;
    const [, popupElement] = portal.props.children;
    const popup = popupElement as ReactElement<{ className: string }>;
    const { className } = popup.props;

    expect(className).toContain("sm:max-w-none");
    expect(className).not.toContain("sm:max-w-sm");
  });
});
