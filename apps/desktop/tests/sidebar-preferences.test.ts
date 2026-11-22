import { describe, expect, it } from "vitest";

import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  parseExpandedScopes,
  readExpandedLabelScopes,
  parseSidebarOpen,
  parseSidebarWidth,
  serializeExpandedScopes,
} from "../src/renderer/src/components/shell/sidebar/sidebar-preferences";

describe("sidebar preferences", () => {
  it("opens the sidebar unless it was last hidden", () => {
    expect(parseSidebarOpen(null)).toBeTruthy();
    expect(parseSidebarOpen("true")).toBeTruthy();
    expect(parseSidebarOpen("false")).toBeFalsy();
    expect(parseSidebarOpen("garbage")).toBeTruthy();
  });

  it("restores the sidebar width and starts at the default", () => {
    expect(parseSidebarWidth(null)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(parseSidebarWidth("288")).toBe(288);
    expect(parseSidebarWidth("287.6")).toBe(288);
  });

  it.each(["", " ", "wide", "NaN", "Infinity"])(
    "falls back to the default width for malformed storage %j",
    (value) => {
      expect(parseSidebarWidth(value)).toBe(DEFAULT_SIDEBAR_WIDTH);
    }
  );

  it("clamps a stored width to the limits instead of dropping it", () => {
    expect(parseSidebarWidth("40")).toBe(MIN_SIDEBAR_WIDTH);
    expect(parseSidebarWidth("4000")).toBe(MAX_SIDEBAR_WIDTH);
  });

  it("keeps the sidebar at least as wide as the measured minimum", () => {
    expect(clampSidebarWidth(180, 214)).toBe(214);
    expect(clampSidebarWidth(260, 214)).toBe(260);
    // A measurement below the floor or above the maximum never escapes them.
    expect(clampSidebarWidth(100, 120)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(500, 900)).toBe(MAX_SIDEBAR_WIDTH);
  });

  it("restores the expanded accounts and starts with none", () => {
    expect([...parseExpandedScopes(null)]).toStrictEqual([]);
    expect([
      ...parseExpandedScopes(JSON.stringify(["one@example.com"])),
    ]).toStrictEqual(["one@example.com"]);
    expect([...parseExpandedScopes(JSON.stringify([]))]).toStrictEqual([]);
  });

  it.each(["{", "{}", JSON.stringify([1, "one@example.com"])])(
    "falls back to the default for malformed storage %s",
    (value) => {
      expect([...parseExpandedScopes(value)]).toStrictEqual([]);
    }
  );

  it("stores only scopes that still exist", () => {
    expect(
      JSON.parse(
        serializeExpandedScopes(
          new Set(["", "gone@example.com", "two@example.com"]),
          ["one@example.com", "two@example.com"]
        )
      )
    ).toStrictEqual(["two@example.com"]);
  });

  it("starts with every account's labels hidden", () => {
    expect([...readExpandedLabelScopes()]).toStrictEqual([]);
  });
});
