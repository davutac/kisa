import { describe, expect, it } from "@effect/vitest";

import { getBulkLabelGroups } from "../src/renderer/src/mail/bulk-thread-selection";
import type {
  GmailLabelSummary,
  GmailThreadSummary,
} from "../src/shared/ipc/mail";

const label = (id: string, name: string): GmailLabelSummary => ({
  id,
  name,
  type: "user",
});

const thread = (
  accountId: string,
  threadId: string,
  labels: readonly string[] = []
): GmailThreadSummary => ({
  accountId,
  attachments: [],
  from: "sender@example.com",
  hasAttachments: false,
  isUnread: false,
  labels,
  latestAt: 0,
  messageCount: 1,
  snippet: "",
  subject: "Subject",
  threadId,
});

describe(getBulkLabelGroups, () => {
  it("groups account-owned labels and their state across selected threads", () => {
    const threads = [
      thread("first@example.com", "one", ["Receipts"]),
      thread("second@example.com", "two"),
    ];
    const catalogs = new Map<string, readonly GmailLabelSummary[]>([
      [
        "first@example.com",
        [label("Label_first", "Receipts"), label("Label_private", "Private")],
      ],
      ["second@example.com", [label("Label_second", "Receipts")]],
    ]);

    const groups = getBulkLabelGroups(threads, catalogs);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      accountId: "first@example.com",
      labels: [
        { appliedCount: 0, id: "Label_private", name: "Private" },
        { appliedCount: 1, id: "Label_first", name: "Receipts" },
      ],
      threads: [{ threadId: "one" }],
    });
    expect(groups[1]).toMatchObject({
      accountId: "second@example.com",
      labels: [{ appliedCount: 0, id: "Label_second", name: "Receipts" }],
      threads: [{ threadId: "two" }],
    });
  });

  it("keeps a group for a selected account while its catalog loads", () => {
    expect(
      getBulkLabelGroups(
        [
          thread("first@example.com", "one"),
          thread("second@example.com", "two"),
        ],
        new Map([["first@example.com", [label("Label_first", "Receipts")]]])
      )
    ).toMatchObject([
      {
        accountId: "first@example.com",
        labels: [{ id: "Label_first", name: "Receipts" }],
      },
      { accountId: "second@example.com", labels: [] },
    ]);
  });
});
