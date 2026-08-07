import { describe, expect, it } from "@effect/vitest";

import {
  extractEmailAddresses,
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
