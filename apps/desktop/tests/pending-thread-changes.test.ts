import { describe, expect, it } from "@effect/vitest";

import { filterThreadsByScope } from "../src/renderer/src/mail/mailbox-model";
import {
  beginPendingThreadChange,
  getPendingLabelIds,
  getPendingThreadChanges,
  projectThreadLabels,
  projectThreadSummaries,
} from "../src/renderer/src/mail/pending-thread-changes";
import type {
  PendingThreadChange,
  PendingThreadChanges,
} from "../src/renderer/src/mail/pending-thread-changes";
import type { MailThreadSummary } from "../src/shared/ipc/mail";

const makeThread = (
  accountId: string,
  threadId: string,
  overrides: Partial<MailThreadSummary> = {}
): MailThreadSummary => ({
  accountId,
  attachments: [],
  from: "Sender <sender@example.com>",
  hasAttachments: false,
  isUnread: false,
  labels: ["INBOX"],
  latestAt: 100,
  messageCount: 1,
  snippet: "Snippet",
  subject: "Subject",
  threadId,
  ...overrides,
});

const pendingOf = (
  entries: readonly (readonly [string, readonly PendingThreadChange[]])[]
): PendingThreadChanges => new Map(entries);

describe(projectThreadSummaries, () => {
  it("leaves the list as it is when nothing is pending", () => {
    const threads = [makeThread("a@example.com", "1")];

    expect(projectThreadSummaries(threads, new Map())).toBe(threads);
  });

  it("applies a conversation's changes in the order they were asked for", () => {
    const thread = makeThread("a@example.com", "1", {
      isUnread: true,
      labels: ["INBOX", "UNREAD"],
    });
    const pending = pendingOf([
      [
        "a@example.com:1",
        [
          { isUnread: false, kind: "setReadState" },
          { isUnread: true, kind: "setReadState" },
          { isUnread: false, kind: "setReadState" },
        ],
      ],
    ]);

    expect(projectThreadSummaries([thread], pending)).toStrictEqual([
      { ...thread, isUnread: false, labels: ["INBOX"] },
    ]);
  });

  it("moves a trashed conversation out of the Inbox and into Trash", () => {
    const trashed = makeThread("a@example.com", "1");
    const kept = makeThread("a@example.com", "2");
    const projected = projectThreadSummaries(
      [trashed, kept],
      pendingOf([["a@example.com:1", [{ kind: "trash" }]]])
    );

    expect(
      filterThreadsByScope(projected, ["a@example.com"], false, "inbox")
    ).toStrictEqual([kept]);
    expect(
      filterThreadsByScope(projected, ["a@example.com"], false, "trash")
    ).toStrictEqual([{ ...trashed, labels: ["TRASH"] }]);
  });

  it("brings a conversation out of Spam or Trash back to the Inbox", () => {
    const spam = makeThread("a@example.com", "1", { labels: ["SPAM"] });
    const [projected] = projectThreadSummaries(
      [spam],
      pendingOf([["a@example.com:1", [{ kind: "moveToInbox" }]]])
    );

    expect(projected?.labels).toStrictEqual(["INBOX"]);
  });

  it("drops a conversation deleted forever", () => {
    const thread = makeThread("a@example.com", "1", { labels: ["TRASH"] });

    expect(
      projectThreadSummaries(
        [thread],
        pendingOf([["a@example.com:1", [{ kind: "deleteForever" }]]])
      )
    ).toStrictEqual([]);
  });

  it("shows a user label by the name conversations list it under", () => {
    const thread = makeThread("a@example.com", "1");
    const [projected] = projectThreadSummaries(
      [thread],
      pendingOf([
        [
          "a@example.com:1",
          [
            {
              applied: true,
              kind: "setLabel",
              labelId: "u:Work",
              labelName: "Work",
            },
          ],
        ],
      ])
    );

    expect(projected?.labels).toStrictEqual(["INBOX", "Work"]);
  });

  it("keeps two accounts' conversations with the same id apart", () => {
    const mine = makeThread("a@example.com", "1");
    const theirs = makeThread("b@example.com", "1");

    expect(
      projectThreadSummaries(
        [mine, theirs],
        pendingOf([["a@example.com:1", [{ kind: "deleteForever" }]]])
      )
    ).toStrictEqual([theirs]);
  });
});

describe(projectThreadLabels, () => {
  it("shows an open conversation's read state and keeps it while deleting", () => {
    const thread = {
      accountId: "a@example.com",
      labels: ["TRASH"],
      threadId: "1",
    };

    expect(
      projectThreadLabels(
        thread,
        pendingOf([
          [
            "a@example.com:1",
            [
              { isUnread: true, kind: "setReadState" },
              { kind: "deleteForever" },
            ],
          ],
        ])
      )
    ).toStrictEqual(["TRASH", "UNREAD"]);
  });

  it("returns the same labels when the conversation has nothing pending", () => {
    const thread = {
      accountId: "a@example.com",
      labels: ["INBOX"],
      threadId: "1",
    };

    expect(
      projectThreadLabels(
        thread,
        pendingOf([["b@example.com:1", [{ kind: "trash" }]]])
      )
    ).toBe(thread.labels);
  });
});

/** The labels a view would show for this window's pending changes now. */
const shown = (): readonly string[] | undefined =>
  projectThreadSummaries(
    [makeThread("a@example.com", "1")],
    getPendingThreadChanges()
  )[0]?.labels;

describe(beginPendingThreadChange, () => {
  it("indexes each change under its conversations until it settles", () => {
    const thread = { accountId: "a@example.com", threadId: "1" };
    const settleTrash = beginPendingThreadChange([thread], { kind: "trash" });
    const settleLabel = beginPendingThreadChange([thread], {
      applied: true,
      kind: "setLabel",
      labelId: "u:Work",
      labelName: "Work",
    });

    expect(shown()).toStrictEqual(["TRASH", "Work"]);
    expect(getPendingLabelIds(thread, getPendingThreadChanges())).toStrictEqual(
      new Set(["u:Work"])
    );

    settleTrash();
    // Settling twice is harmless.
    settleTrash();

    expect(shown()).toStrictEqual(["INBOX", "Work"]);

    settleLabel();

    expect(getPendingThreadChanges().size).toBe(0);
    expect(shown()).toStrictEqual(["INBOX"]);
  });
});
