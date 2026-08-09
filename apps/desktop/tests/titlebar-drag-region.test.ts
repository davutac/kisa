import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const desktopRoot = path.resolve(import.meta.dirname, "..");
const mainCss = fs.readFileSync(
  path.join(desktopRoot, "src/renderer/src/assets/main.css"),
  "utf-8"
);
const threadItem = fs.readFileSync(
  path.join(desktopRoot, "src/renderer/src/components/mail/thread-item.tsx"),
  "utf-8"
);

const getRule = (selector: string): string | undefined => {
  const escapedSelector = selector.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return mainCss.match(
    new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "u")
  )?.[1];
};

const selectorDeclares = (selector: string, declaration: string): boolean => {
  const escapedSelector = selector.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const escapedDeclaration = declaration.replaceAll(
    /[.*+?^${}()|[\]\\]/gu,
    "\\$&"
  );

  return new RegExp(
    `${escapedSelector}[^{}]*\\{[^}]*${escapedDeclaration}`,
    "u"
  ).test(mainCss);
};

describe("titlebar drag region", () => {
  it("keeps the full thread-row button out of the native no-drag region", () => {
    expect(threadItem).toContain("<button");
    expect(
      selectorDeclares("button:not(:disabled)", "-webkit-app-region: no-drag")
    ).toBeFalsy();
  });

  it("keeps titlebar controls interactive", () => {
    expect(getRule(".app-titlebar")).toContain("-webkit-app-region: drag");
    expect(getRule(".app-titlebar-interactive")).toContain(
      "-webkit-app-region: no-drag"
    );
  });
});
