import type { ListResponse } from "imapflow";
import { describe, expect, it } from "vitest";

import { toMailbox, toMailboxes } from "../src/main/mail/engine/imap-session";

const entry = (
  path: string,
  specialUse?: string,
  specialUseSource?: ListResponse["specialUseSource"],
  flags: readonly string[] = []
) => ({
  delimiter: "/",
  flags: new Set<string>(flags),
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

  it("prefers a role attribute sent without SPECIAL-USE over a folder's name", () => {
    // imapflow ignores the attribute without the capability and gives the
    // role to the folder whose name matches first.
    const listed = toMailboxes(
      [
        entry("Sent", "\\Sent", "name"),
        entry("Sent Items", undefined, undefined, [
          "\\HasNoChildren",
          "\\Sent",
        ]),
        entry("Junk-E-Mail", "\\Junk", "name"),
      ],
      false
    );

    expect(listed.map((mailbox) => [mailbox.path, mailbox.role])).toStrictEqual(
      [
        ["Sent", "none"],
        ["Sent Items", "sent"],
        ["Junk-E-Mail", "junk"],
      ]
    );
  });
});
