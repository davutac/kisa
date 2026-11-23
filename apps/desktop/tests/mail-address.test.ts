import { describe, expect, it } from "@effect/vitest";

import {
  extractEmailAddresses,
  findEmailAddressSuggestions,
  getThreadEmailAddresses,
  mergeUniqueEmailAddresses,
  parseEmailAddressList,
  parseMailboxAddress,
} from "../src/renderer/src/mail/address";

describe(extractEmailAddresses, () => {
  it("extracts an address from a named sender", () => {
    expect(
      extractEmailAddresses("Cloudflare <em@em1.cloudflare.com>")
    ).toStrictEqual(["em@em1.cloudflare.com"]);
  });

  it("extracts multiple recipient addresses", () => {
    expect(
      extractEmailAddresses(
        'Davut <davut@example.com>, "Kisa App" <hello@kisa.dev>'
      )
    ).toStrictEqual(["davut@example.com", "hello@kisa.dev"]);
  });

  it("returns no addresses for a missing header", () => {
    expect(extractEmailAddresses()).toStrictEqual([]);
  });

  // The previous pattern took seconds on this header, and a synchronous regex
  // cannot be interrupted by the test timeout, so the bound is asserted
  // directly.
  it("scans a long run without an address in linear time", () => {
    const start = performance.now();

    expect(extractEmailAddresses("a".repeat(65_536))).toStrictEqual([]);
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe(parseEmailAddressList, () => {
  it("parses comma, semicolon, and newline-separated addresses", () => {
    expect(
      parseEmailAddressList(
        "first@example.com; Second <second@example.com>\nthird@example.com"
      )
    ).toStrictEqual([
      "first@example.com",
      "second@example.com",
      "third@example.com",
    ]);
  });

  it("ignores text that contains no email addresses", () => {
    expect(parseEmailAddressList("not an address")).toStrictEqual([]);
  });

  it("rejects a list containing an invalid address", () => {
    expect(
      parseEmailAddressList("first@example.com, not an address")
    ).toStrictEqual([]);
  });
});

describe(mergeUniqueEmailAddresses, () => {
  it("deduplicates addresses case-insensitively", () => {
    expect(
      mergeUniqueEmailAddresses(
        ["first@example.com"],
        ["FIRST@example.com", "second@example.com", "second@example.com"]
      )
    ).toStrictEqual(["first@example.com", "second@example.com"]);
  });
});

describe(getThreadEmailAddresses, () => {
  it("prioritizes recent thread participants and excludes the account", () => {
    expect(
      getThreadEmailAddresses(
        [
          {
            from: "First <first@example.com>",
            to: "user@example.com",
          },
          {
            cc: "Teammate <team@example.com>",
            from: "Second <second@example.com>",
            replyTo: "Replies <reply@example.com>",
            to: "user@example.com, first@example.com",
          },
        ],
        ["USER@example.com"]
      )
    ).toStrictEqual([
      "reply@example.com",
      "second@example.com",
      "first@example.com",
      "team@example.com",
    ]);
  });
});

describe(findEmailAddressSuggestions, () => {
  it("returns case-insensitive prefix matches in order, an exact one first", () => {
    expect(
      findEmailAddressSuggestions("TES", [
        { address: "another@example.com" },
        { address: "test@example.com.au" },
        { address: "test@example.com", name: "Test" },
      ])
    ).toStrictEqual([
      { address: "test@example.com.au" },
      { address: "test@example.com", name: "Test" },
    ]);
    expect(
      findEmailAddressSuggestions("test@example.com", [
        { address: "test@example.com.au" },
        { address: "Test@example.com" },
      ])
    ).toStrictEqual([
      { address: "Test@example.com" },
      { address: "test@example.com.au" },
    ]);
  });

  it("skips committed and repeated addresses, and empty or padded drafts", () => {
    expect(
      findEmailAddressSuggestions(
        "tes",
        [
          { address: "test@example.com" },
          { address: "tess@example.com" },
          { address: "TESS@example.com" },
        ],
        ["TEST@example.com"]
      )
    ).toStrictEqual([{ address: "tess@example.com" }]);
    expect(
      findEmailAddressSuggestions("", [{ address: "test@example.com" }])
    ).toStrictEqual([]);
    expect(
      findEmailAddressSuggestions(" tes", [{ address: "test@example.com" }])
    ).toStrictEqual([]);
  });

  it("keeps the list short", () => {
    const candidates = Array.from({ length: 12 }, (_, index) => ({
      address: `t${index}@example.com`,
    }));

    expect(findEmailAddressSuggestions("t", candidates, [], 3)).toHaveLength(3);
  });
});

describe(parseMailboxAddress, () => {
  it("preserves the sender name and email address", () => {
    expect(
      parseMailboxAddress('"Cloudflare Team" <em@em1.cloudflare.com>')
    ).toStrictEqual({
      email: "em@em1.cloudflare.com",
      name: "Cloudflare Team",
    });
  });

  it("supports headers containing only an email address", () => {
    expect(parseMailboxAddress("hello@kisa.dev")).toStrictEqual({
      email: "hello@kisa.dev",
    });
  });

  it("uses the raw header when it contains no email address", () => {
    expect(parseMailboxAddress("Unknown sender")).toStrictEqual({
      email: "Unknown sender",
    });
  });
});
