import { describe, expect, it } from "vitest";

import {
  resolveTitlebarViewToggle,
  toTitlebarViewPath,
} from "../src/renderer/src/components/shell/titlebar-view-toggle";

describe("titlebar view toggles", () => {
  it.each(["/templates", "/settings"] as const)(
    "opens and closes %s as a toggle",
    (targetPath) => {
      expect(
        resolveTitlebarViewToggle({
          currentPath: "/",
          previousPath: null,
          targetPath,
        })
      ).toBe(targetPath);

      expect(
        resolveTitlebarViewToggle({
          currentPath: targetPath,
          previousPath: "/",
          targetPath,
        })
      ).toBe("/");
    }
  );

  it("falls back to the mailbox when no previous view was captured", () => {
    expect(
      resolveTitlebarViewToggle({
        currentPath: "/settings",
        previousPath: null,
        targetPath: "/settings",
      })
    ).toBe("/");
  });

  it("restores another workspace view", () => {
    expect(
      resolveTitlebarViewToggle({
        currentPath: "/templates",
        previousPath: "/settings",
        targetPath: "/templates",
      })
    ).toBe("/settings");
  });

  it("normalizes non-titlebar routes to the mailbox fallback", () => {
    expect(toTitlebarViewPath("/thread/account/thread")).toBe("/");
  });
});
