import type { ListResponse } from "imapflow";
import { describe, expect, it } from "vitest";

import { toMailbox } from "../src/main/mail/engine/imap-session";

const entry = (
  path: string,
  specialUse?: string,
  specialUseSource?: ListResponse["specialUseSource"]
) => ({
  delimiter: "/",
  flags: new Set<string>(),
  path,
  specialUse,
  specialUseSource,
});

describe("mailbox roles", () => {
  it("reads roles from well-known names when the server has no SPECIAL-USE", () => {
    expect(
      [
        entry("Sent Messages", "\\Sent", "name"),
        entry("Deleted Messages", "\\Trash", "name"),
        entry("Receipts"),
      ].map((mailbox) => toMailbox(mailbox, false).role)
    ).toStrictEqual(["sent", "trash", "none"]);
  });

  it("trusts only the server's attributes when it has SPECIAL-USE", () => {
    expect(
      [
        entry("[Gmail]/Trash", "\\Trash", "extension"),
        entry("Archive", "\\Archive", "name"),
      ].map((mailbox) => toMailbox(mailbox, true).role)
    ).toStrictEqual(["trash", "none"]);
  });
});
