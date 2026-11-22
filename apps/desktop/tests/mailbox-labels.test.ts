import { describe, expect, it } from "@effect/vitest";

import {
  createMailboxLabelItems,
  isMailboxLabelMissing,
  threadHasMailboxLabel,
  toMailboxLabelRows,
} from "../src/renderer/src/mail/mailbox-labels";
import type { MailboxLabelItem } from "../src/renderer/src/mail/mailbox-labels";

describe(createMailboxLabelItems, () => {
  it("shows user labels and merges equal names across accounts", () => {
    expect(
      createMailboxLabelItems([
        {
          accountId: "one@example.com",
          labels: [
            { id: "INBOX", name: "INBOX", type: "system" },
            {
              color: { background: "#16a766", text: "#ffffff" },
              id: "Label_1",
              name: "Work",
              type: "user",
            },
          ],
        },
        {
          accountId: "two@example.com",
          labels: [
            {
              color: { background: "#16a766", text: "#ffffff" },
              id: "Label_9",
              name: "work",
              type: "user",
            },
            { id: "Label_2", name: "Travel", type: "user" },
          ],
        },
      ])
    ).toStrictEqual([
      {
        accountIds: ["two@example.com"],
        color: undefined,
        key: "travel",
        name: "Travel",
      },
      {
        accountIds: ["one@example.com", "two@example.com"],
        color: { background: "#16a766", text: "#ffffff" },
        key: "work",
        name: "Work",
      },
    ]);
  });

  it("uses a neutral color when account colors conflict", () => {
    const [item] = createMailboxLabelItems([
      {
        accountId: "one@example.com",
        labels: [
          {
            color: { background: "#16a766", text: "#ffffff" },
            id: "Label_1",
            name: "Work",
            type: "user",
          },
        ],
      },
      {
        accountId: "two@example.com",
        labels: [
          {
            color: { background: "#0d3472", text: "#ffffff" },
            id: "Label_2",
            name: "Work",
            type: "user",
          },
        ],
      },
    ]);

    expect(item?.color).toBeUndefined();
  });
});

const labelItem = (name: string): MailboxLabelItem => ({
  accountIds: ["one@example.com"],
  key: name.toLowerCase(),
  name,
});

describe(toMailboxLabelRows, () => {
  it("nests labels under their parents, depth first", () => {
    expect(
      toMailboxLabelRows(
        ["Work/Clients", "Travel", "Work", "Work/Clients/Acme"].map(labelItem)
      ).map(({ depth, name }) => [depth, name])
    ).toStrictEqual([
      [0, "Travel"],
      [0, "Work"],
      [1, "Clients"],
      [2, "Acme"],
    ]);
  });

  it("keeps the path a missing parent would have held", () => {
    expect(
      toMailboxLabelRows(
        ["Work", "Work/Clients/Acme", "Home/Bills"].map(labelItem)
      ).map(({ depth, name }) => [depth, name])
    ).toStrictEqual([
      [0, "Home/Bills"],
      [0, "Work"],
      [1, "Clients/Acme"],
    ]);
  });
});

describe(threadHasMailboxLabel, () => {
  it("matches a user label without regard to case", () => {
    expect(threadHasMailboxLabel(["INBOX", "work"], "Work")).toBeTruthy();
    expect(
      threadHasMailboxLabel(["INBOX", "Work/Clients"], "Work")
    ).toBeFalsy();
  });

  it("never matches a system label to a folder named like it", () => {
    expect(threadHasMailboxLabel(["SPAM"], "Spam")).toBeFalsy();
    expect(threadHasMailboxLabel(["Spam"], "Spam")).toBeTruthy();
  });
});

describe(isMailboxLabelMissing, () => {
  const work = { id: "u:Work", name: "Work", type: "user" };
  const catalogs = new Map([
    ["one@example.com", [work]],
    ["two@example.com", []],
  ]);

  it("finds a label gone only once every catalog in the scope has loaded", () => {
    const ready = new Map([
      ["one@example.com", "ready" as const],
      ["two@example.com", "ready" as const],
    ]);

    expect(
      isMailboxLabelMissing("work", ["one@example.com"], catalogs, ready)
    ).toBeFalsy();
    expect(
      isMailboxLabelMissing("Work", ["two@example.com"], catalogs, ready)
    ).toBeTruthy();
    expect(
      isMailboxLabelMissing(
        "Work",
        ["one@example.com", "two@example.com"],
        catalogs,
        ready
      )
    ).toBeFalsy();
  });

  it.each(["loading", "unavailable"] as const)(
    "keeps the label while a catalog is %s",
    (status) => {
      expect(
        isMailboxLabelMissing(
          "Work",
          ["two@example.com"],
          catalogs,
          new Map([["two@example.com", status]])
        )
      ).toBeFalsy();
    }
  );
});
