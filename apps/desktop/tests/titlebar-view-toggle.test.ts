import { describe, expect, it } from "vitest";

import {
  resolveTitlebarViewToggle,
  shouldShowTitlebarScheduledButton,
  toTitlebarViewPath,
} from "../src/renderer/src/components/shell/titlebar-view-toggle";

describe("titlebar view toggles", () => {
  it.each(["/scheduled", "/templates", "/settings"] as const)(
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

  it("shows Scheduled only while it is open or scheduled mail exists", () => {
    expect(shouldShowTitlebarScheduledButton(false, false)).toBeFalsy();
    expect(shouldShowTitlebarScheduledButton(false, true)).toBeTruthy();
    expect(shouldShowTitlebarScheduledButton(true, false)).toBeTruthy();
  });
});
