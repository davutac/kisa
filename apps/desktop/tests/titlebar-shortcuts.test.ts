import { describe, expect, it } from "@effect/vitest";

import {
  ALL_ACCOUNTS_SHORTCUT,
  getAccountShortcut,
  getNewMessageShortcutKeys,
  getSearchShortcutKeys,
  NEW_MESSAGE_SHORTCUT,
  SETTINGS_SHORTCUT,
} from "../src/renderer/src/shell/titlebar-shortcuts";

describe(getAccountShortcut, () => {
  it("numbers the accounts after the all-accounts shortcut", () => {
    expect(ALL_ACCOUNTS_SHORTCUT).toBe("1");
    expect(getAccountShortcut(0)).toBe("2");
    expect(getAccountShortcut(1)).toBe("3");
  });

  it("stops at the end of the number row", () => {
    expect(getAccountShortcut(7)).toBe("9");
    expect(getAccountShortcut(8)).toBeUndefined();
  });

  it("spells the search shortcut the way each platform does", () => {
    expect(getSearchShortcutKeys("mac")).toStrictEqual(["⌘", "K"]);
    expect(getSearchShortcutKeys("windows")).toStrictEqual(["Ctrl", "K"]);
    expect(getSearchShortcutKeys("linux")).toStrictEqual(["Ctrl", "K"]);
  });

  it("spells the new-message shortcut the way each platform does", () => {
    expect(NEW_MESSAGE_SHORTCUT).toBe("Mod+N");
    expect(getNewMessageShortcutKeys("mac")).toStrictEqual(["⌘", "N"]);
    expect(getNewMessageShortcutKeys("windows")).toStrictEqual(["Ctrl", "N"]);
    expect(getNewMessageShortcutKeys("linux")).toStrictEqual(["Ctrl", "N"]);
  });

  it("leaves the last digit to settings", () => {
    expect(SETTINGS_SHORTCUT).toBe("0");
    expect(
      Array.from({ length: 8 }, (_, index) => getAccountShortcut(index))
    ).not.toContain(SETTINGS_SHORTCUT);
  });
});
