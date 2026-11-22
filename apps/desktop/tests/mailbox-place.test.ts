import { describe, expect, it } from "vitest";

import {
  getMailboxPlaceCrumbs,
  getMailboxPlaceKey,
  isSameMailboxPlace,
} from "../src/renderer/src/mail/mailbox-place";

describe("mailbox places", () => {
  it("tells a label from a mailbox named like it, and ignores label case", () => {
    expect(
      isSameMailboxPlace({ label: "Work" }, { label: "work" })
    ).toBeTruthy();
    expect(isSameMailboxPlace({ label: "Sent" }, "sent")).toBeFalsy();
    expect(getMailboxPlaceKey({ label: "Sent" })).not.toBe(
      getMailboxPlaceKey("sent")
    );
  });
});

describe(getMailboxPlaceCrumbs, () => {
  it("names a mailbox alone", () => {
    expect(getMailboxPlaceCrumbs("sent", new Set())).toStrictEqual([
      { name: "Sent" },
    ]);
  });

  it("splits a label's path where its ancestors are labels", () => {
    expect(
      getMailboxPlaceCrumbs(
        { label: "Work/Clients/Acme" },
        new Set(["work", "work/clients/acme"])
      )
    ).toStrictEqual([
      { name: "Work", place: { label: "Work" } },
      { name: "Clients/Acme" },
    ]);
    expect(
      getMailboxPlaceCrumbs(
        { label: "Work/Clients/Acme" },
        new Set(["work", "work/clients", "work/clients/acme"])
      )
    ).toStrictEqual([
      { name: "Work", place: { label: "Work" } },
      { name: "Clients", place: { label: "Work/Clients" } },
      { name: "Acme" },
    ]);
  });

  it("keeps a path whose parents are not labels in one crumb", () => {
    expect(
      getMailboxPlaceCrumbs({ label: "Home/Bills" }, new Set(["home/bills"]))
    ).toStrictEqual([{ name: "Home/Bills" }]);
  });
});
