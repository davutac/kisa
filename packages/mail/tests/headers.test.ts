import { describe, expect, it } from "vitest";

import {
  decodeEncodedWords,
  getHeaderValue,
  getHeaderValues,
  parseHeaderBlock,
  parseMessageIds,
} from "../src/headers";

describe(decodeEncodedWords, () => {
  it("decodes base64 and Q words in any charset", () => {
    expect(decodeEncodedWords("=?UTF-8?B?w7xiZXI=?= alles")).toBe("über alles");
    expect(decodeEncodedWords("=?iso-8859-1?q?Gr=FC=DFe_aus?= Berlin")).toBe(
      "Grüße aus Berlin"
    );
  });

  it("drops whitespace between words and joins split multi-byte characters", () => {
    // "€" is E2 82 AC, split across two words.
    expect(
      decodeEncodedWords("=?UTF-8?Q?Preis_=E2=82?=\r\n =?UTF-8?Q?=AC?=")
    ).toBe("Preis €");
  });

  it("keeps text between words that is not whitespace", () => {
    expect(decodeEncodedWords("=?UTF-8?Q?a?= and =?UTF-8?Q?b?=")).toBe(
      "a and b"
    );
  });

  it("ignores a language tag and survives unknown charsets", () => {
    expect(decodeEncodedWords("=?UTF-8*en?Q?hi?=")).toBe("hi");
    expect(decodeEncodedWords("=?x-nope?Q?hi?=")).toBe("hi");
  });

  it("leaves plain text and malformed words alone", () => {
    expect(decodeEncodedWords("plain subject")).toBe("plain subject");
    expect(decodeEncodedWords("=?UTF-8?X?nope?=")).toBe("=?UTF-8?X?nope?=");
  });
});

describe(parseHeaderBlock, () => {
  const block = Buffer.from(
    [
      "From: =?UTF-8?Q?J=C3=BCrgen?= <j@example.com>",
      "Subject: a long",
      "\tfolded subject",
      "Received: one",
      "Received: two",
      "not a header line",
      "Bad Name: skipped",
      "",
      "body: not a header",
    ].join("\r\n")
  );

  it("unfolds, decodes and stops at the blank line", () => {
    const headers = parseHeaderBlock(block);

    expect(getHeaderValue(headers, "from")).toBe("Jürgen <j@example.com>");
    expect(getHeaderValue(headers, "SUBJECT")).toBe("a long\tfolded subject");
    expect(getHeaderValues(headers, "received")).toStrictEqual(["one", "two"]);
    expect(getHeaderValue(headers, "body")).toBeUndefined();
    expect(headers.map((header) => header.name)).toStrictEqual([
      "From",
      "Subject",
      "Received",
      "Received",
    ]);
  });

  it("caps the number of fields", () => {
    const many = Buffer.from(
      Array.from({ length: 1200 }, (_, index) => `X-${index}: v`).join("\n")
    );

    expect(parseHeaderBlock(many)).toHaveLength(1000);
  });
});

describe(parseMessageIds, () => {
  it("reads bracketed ids in order", () => {
    expect(parseMessageIds("<root@a> <mid@b>\r\n <last@c>")).toStrictEqual([
      "root@a",
      "mid@b",
      "last@c",
    ]);
  });

  it("accepts one bare id and rejects free text", () => {
    expect(parseMessageIds("bare@id")).toStrictEqual(["bare@id"]);
    expect(parseMessageIds("two words")).toStrictEqual([]);
    expect(parseMessageIds()).toStrictEqual([]);
  });
});
