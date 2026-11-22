import { describe, expect, it } from "vitest";

import {
  parseExpandedScopes,
  readExpandedLabelScopes,
  parseSidebarOpen,
  serializeExpandedScopes,
} from "../src/renderer/src/components/shell/sidebar/sidebar-preferences";

describe("sidebar preferences", () => {
  it("opens the sidebar unless it was last hidden", () => {
    expect(parseSidebarOpen(null)).toBeTruthy();
    expect(parseSidebarOpen("true")).toBeTruthy();
    expect(parseSidebarOpen("false")).toBeFalsy();
    expect(parseSidebarOpen("garbage")).toBeTruthy();
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
