import { describe, expect, it } from "vitest";

import {
  toContainsPattern,
  toFtsMatchQuery,
} from "../src/main/mail/search-match";

describe(toFtsMatchQuery, () => {
  it("makes every word a prefix so matches arrive while typing", () => {
    expect(toFtsMatchQuery("invoice march")).toBe('"invoice"* "march"*');
  });

  it("splits an address the way the tokenizer stored it", () => {
    expect(toFtsMatchQuery("test@gmail.com")).toBe('"test gmail com"*');
  });

  it("quotes text that would otherwise be read as FTS syntax", () => {
    expect(toFtsMatchQuery('re: "urgent" (again)')).toBe(
      '"re"* "urgent"* "again"*'
    );
  });

  it("gives no query when nothing tokenizable is left", () => {
    expect(toFtsMatchQuery("   ")).toBeUndefined();
    expect(toFtsMatchQuery("-*^")).toBeUndefined();
  });
});

describe(toContainsPattern, () => {
  it("matches the value anywhere", () => {
    expect(toContainsPattern("jane@example.com")).toBe("%jane@example.com%");
  });

  it("escapes the wildcards a user can type", () => {
    expect(toContainsPattern("50%_off")).toBe("%50\\%\\_off%");
  });
});
