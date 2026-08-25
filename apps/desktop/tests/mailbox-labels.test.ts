import { describe, expect, it } from "@effect/vitest";

import {
  createMailboxLabelItems,
  normalizeMailboxLabelSelection,
  retainAvailableMailboxLabels,
  threadMatchesMailboxLabels,
} from "../src/renderer/src/mail/mailbox-labels";

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

describe("mailbox label selection", () => {
  it("normalizes, deduplicates, and sorts selected names", () => {
    expect(
      normalizeMailboxLabelSelection([" Work ", "travel", "WORK"])
    ).toStrictEqual(["travel", "work"]);
  });

  it("retains only labels available in a new account scope", () => {
    expect(
      retainAvailableMailboxLabels(
        ["travel", "work"],
        [{ accountIds: ["one@example.com"], key: "work", name: "Work" }]
      )
    ).toStrictEqual(["work"]);
  });

  it("requires every selected label on a thread", () => {
    expect(
      threadMatchesMailboxLabels(
        ["INBOX", "Work", "Travel"],
        ["travel", "work"]
      )
    ).toBeTruthy();
    expect(
      threadMatchesMailboxLabels(["INBOX", "Work"], ["travel", "work"])
    ).toBeFalsy();
  });
});
