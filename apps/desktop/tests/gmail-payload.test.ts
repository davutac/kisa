import { describe, expect, it } from "vitest";

import { parseMailbox } from "../src/main/mail/gmail-payload";

const mailbox = (value: string) => {
  const parsed = parseMailbox(value);

  return parsed === undefined
    ? undefined
    : { address: parsed.address, name: parsed.name };
};

describe(parseMailbox, () => {
  it("reads named, quoted, angle-only and bare mailboxes", () => {
    expect(mailbox("Alice <alice@example.com>")).toStrictEqual({
      address: "alice@example.com",
      name: "Alice",
    });
    expect(mailbox(' "Doe, John"  <john@example.com> ')).toStrictEqual({
      address: "john@example.com",
      name: "Doe, John",
    });
    expect(mailbox("<alice@example.com>")).toStrictEqual({
      address: "alice@example.com",
      name: undefined,
    });
    expect(mailbox(" alice@example.com ")).toStrictEqual({
      address: "alice@example.com",
      name: undefined,
    });
  });

  it.each([
    "",
    "<>",
    "< >",
    "alice@",
    "Alice alice@example.com",
    "Alice <alice@example.com> trailing",
    'A"lice <alice@example.com>',
  ])("rejects the malformed mailbox %j", (value) => {
    expect(mailbox(value)).toBeUndefined();
  });

  // The previous pattern took seconds on this header, and a synchronous regex
  // cannot be interrupted by the test timeout, so the bound is asserted
  // directly.
  it("reads a header of whitespace in linear time", () => {
    const start = performance.now();

    expect(mailbox(`${" ".repeat(2000)}x`)).toBeUndefined();
    expect(performance.now() - start).toBeLessThan(500);
  });
});
