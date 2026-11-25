import { describe, expect, it } from "@effect/vitest";

import { filterThreadsByScope } from "../src/renderer/src/mail/mailbox-model";
import {
  beginPendingThreadChange,
  getPendingLabelIds,
  getPendingThreadChanges,
  projectOpenThread,
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
  places: ["inbox"],
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
    ).toStrictEqual([{ ...trashed, labels: ["TRASH"], places: ["trash"] }]);
  });

  it("takes an archived conversation off the Inbox, even one with a reply in Sent", () => {
    const archived = makeThread("a@example.com", "1", {
      labels: ["INBOX", "SENT"],
      places: ["inbox", "sent"],
    });
    const projected = projectThreadSummaries(
      [archived],
      pendingOf([
        [
          "a@example.com:1",
          [
            {
              applied: false,
              kind: "setLabel",
              labelId: "INBOX",
              labelName: "INBOX",
            },
          ],
        ],
      ])
    );

    expect(
      filterThreadsByScope(projected, ["a@example.com"], false, "inbox")
    ).toStrictEqual([]);
    expect(
      filterThreadsByScope(projected, ["a@example.com"], false, "sent")
    ).toStrictEqual([{ ...archived, labels: ["SENT"], places: ["sent"] }]);
  });

  it("lists a conversation as starred, and moves a reported one into Spam", () => {
    const starred = makeThread("a@example.com", "1");
    const reported = makeThread("a@example.com", "2");
    const projected = projectThreadSummaries(
      [starred, reported],
      pendingOf([
        [
          "a@example.com:1",
          [
            {
              applied: true,
              kind: "setLabel",
              labelId: "STARRED",
              labelName: "STARRED",
            },
          ],
        ],
        ["a@example.com:2", [{ kind: "moveToSpam" }]],
      ])
    );

    expect({
      inbox: filterThreadsByScope(projected, ["a@example.com"], false),
      spam: filterThreadsByScope(projected, ["a@example.com"], false, "spam"),
      starred: filterThreadsByScope(
        projected,
        ["a@example.com"],
        false,
        "starred"
      ),
    }).toStrictEqual({
      inbox: [
        {
          ...starred,
          labels: ["INBOX", "STARRED"],
          places: ["inbox", "starred"],
        },
      ],
      spam: [{ ...reported, labels: ["SPAM"], places: ["spam"] }],
      starred: [
        {
          ...starred,
          labels: ["INBOX", "STARRED"],
          places: ["inbox", "starred"],
        },
      ],
    });
  });

  it("brings a conversation out of Spam or Trash back to the Inbox", () => {
    const spam = makeThread("a@example.com", "1", {
      labels: ["SPAM"],
      places: ["spam"],
    });
    const [projected] = projectThreadSummaries(
      [spam],
      pendingOf([["a@example.com:1", [{ kind: "moveToInbox" }]]])
    );

    expect(projected).toMatchObject({ labels: ["INBOX"], places: ["inbox"] });
  });

  // Undo of a trash made in a label's list: the row is back there at once,
  // not when the server answers.
  it("brings a trashed conversation straight back into its label's list", () => {
    const trashed = makeThread("a@example.com", "1", {
      labels: ["TRASH", "Work"],
      places: ["trash"],
    });
    const projected = projectThreadSummaries(
      [trashed],
      pendingOf([["a@example.com:1", [{ kind: "moveToInbox" }]]])
    );

    expect(
      filterThreadsByScope(projected, ["a@example.com"], false, {
        label: "Work",
      })
    ).toStrictEqual([
      {
        ...trashed,
        labels: ["Work", "INBOX"],
        places: ["inbox", "label:work"],
      },
    ]);
  });

  it("keeps the places main sent while a pending change moves the conversation nowhere", () => {
    // A folder the server calls TRASH: its name reads as the Trash mailbox.
    const inFolderCalledTrash = makeThread("a@example.com", "1", {
      isUnread: true,
      labels: ["INBOX", "TRASH", "UNREAD"],
      places: ["inbox", "label:trash"],
    });
    const [projected] = projectThreadSummaries(
      [inFolderCalledTrash],
      pendingOf([
        ["a@example.com:1", [{ isUnread: false, kind: "setReadState" }]],
      ])
    );

    expect(projected).toMatchObject({
      isUnread: false,
      places: ["inbox", "label:trash"],
    });
  });

  it("drops a conversation deleted forever", () => {
    const thread = makeThread("a@example.com", "1", {
      labels: ["TRASH"],
      places: ["trash"],
    });

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

describe(projectOpenThread, () => {
  it("shows an open conversation's read state and keeps it while deleting", () => {
    const thread = {
      accountId: "a@example.com",
      labels: ["TRASH"],
      places: ["trash"],
      threadId: "1",
    };

    expect(
      projectOpenThread(
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
    ).toStrictEqual({ labels: ["TRASH", "UNREAD"], places: ["trash"] });
  });

  it("is in Trash, for what its view offers, while a trash is on its way", () => {
    const thread = {
      accountId: "a@example.com",
      labels: ["INBOX"],
      places: ["inbox"],
      threadId: "1",
    };

    expect(
      projectOpenThread(
        thread,
        pendingOf([["a@example.com:1", [{ kind: "trash" }]]])
      )
    ).toStrictEqual({ labels: ["TRASH"], places: ["trash"] });
  });

  it("returns the conversation itself when it has nothing pending", () => {
    const thread = {
      accountId: "a@example.com",
      labels: ["INBOX"],
      places: ["inbox"],
      threadId: "1",
    };

    expect(
      projectOpenThread(
        thread,
        pendingOf([["b@example.com:1", [{ kind: "trash" }]]])
      )
    ).toBe(thread);
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
