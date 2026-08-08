import { describe, expect, it } from "@effect/vitest";

import {
  extractEmailAddresses,
  findEmailAddressCompletion,
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

describe(findEmailAddressCompletion, () => {
  it("returns the first case-insensitive prefix match", () => {
    expect(
      findEmailAddressCompletion("TES", [
        "another@example.com",
        "test@example.com",
      ])
    ).toBe("test@example.com");
  });

  it("does not suggest committed, exact, empty, or whitespace drafts", () => {
    expect(
      findEmailAddressCompletion(
        "tes",
        ["test@example.com"],
        ["TEST@example.com"]
      )
    ).toBeUndefined();
    expect(
      findEmailAddressCompletion("test@example.com", ["test@example.com"])
    ).toBeUndefined();
    expect(
      findEmailAddressCompletion("", ["test@example.com"])
    ).toBeUndefined();
    expect(
      findEmailAddressCompletion(" tes", ["test@example.com"])
    ).toBeUndefined();
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
