import { describe, expect, it } from "@effect/vitest";

import {
  createCachedThreadPageRequest,
  filterThreadsByScope,
  getMailboxScopeKey,
  mergeAndSortThreads,
  replaceFirstPage,
} from "../src/renderer/src/mail/mailbox-model";
import type { MailThreadSummary } from "../src/shared/ipc/mail";

const makeThread = (
  accountId: string,
  threadId: string,
  latestAt: number,
  overrides: Partial<MailThreadSummary> = {}
): MailThreadSummary => ({
  accountId,
  attachments: [],
  from: "Sender <sender@example.com>",
  hasAttachments: false,
  isUnread: false,
  labels: ["INBOX"],
  latestAt,
  messageCount: 1,
  snippet: "Snippet",
  subject: "Subject",
  threadId,
  ...overrides,
});

describe(mergeAndSortThreads, () => {
  it("deduplicates account threads and sorts the newest first", () => {
    const older = makeThread("one@example.com", "thread-1", 100);
    const replacement = makeThread("one@example.com", "thread-1", 300, {
      subject: "Updated",
    });
    const middle = makeThread("two@example.com", "thread-2", 200);

    expect(mergeAndSortThreads([older, middle], [replacement])).toStrictEqual([
      replacement,
      middle,
    ]);
  });
});

describe(replaceFirstPage, () => {
  const newest = makeThread("one@example.com", "newest", 500);
  const gone = makeThread("one@example.com", "gone", 400);
  const kept = makeThread("one@example.com", "kept", 300);
  const beyond = makeThread("one@example.com", "beyond", 100);

  // A conversation that left the mailbox while no event said so is listed
  // until something drops it. A fresh first page covers its range.
  it("drops listed rows inside the fresh first page that the page no longer has", () => {
    expect(
      replaceFirstPage([newest, gone, kept, beyond], [newest, kept], true)
    ).toStrictEqual([newest, kept, beyond]);
  });

  it("drops every row the page lacks when the page is the whole mailbox", () => {
    expect(
      replaceFirstPage([newest, gone, kept, beyond], [newest, kept], false)
    ).toStrictEqual([newest, kept]);
    expect(replaceFirstPage([newest, gone], [], false)).toStrictEqual([]);
  });

  // Server dates have one-second resolution, so ties are common. The list
  // breaks them as the page query does: account, then thread id.
  it("keeps a row tied with the page's last row that sorts after it", () => {
    const last = makeThread("one@example.com", "m", 300);
    const tiedBefore = makeThread("one@example.com", "a", 300);
    const tiedAfter = makeThread("one@example.com", "z", 300);
    const tiedOtherAccount = makeThread("two@example.com", "a", 300);

    expect(
      replaceFirstPage(
        [tiedBefore, last, tiedAfter, tiedOtherAccount],
        [last],
        true
      )
    ).toStrictEqual([last, tiedAfter, tiedOtherAccount]);
  });

  it("takes the page's newer copy of a row", () => {
    const updated = makeThread("one@example.com", "kept", 300, {
      subject: "Updated",
    });

    expect(
      replaceFirstPage([newest, kept], [newest, updated], true)
    ).toStrictEqual([newest, updated]);
  });
});

describe(filterThreadsByScope, () => {
  it("shows Inbox and Sent conversations in Inbox while preserving unread scope", () => {
    const unread = makeThread("one@example.com", "unread", 300, {
      isUnread: true,
    });
    const read = makeThread("one@example.com", "read", 200);
    const trashed = makeThread("one@example.com", "trashed", 100, {
      isUnread: true,
      labels: ["TRASH"],
    });
    const otherAccount = makeThread("two@example.com", "other", 400, {
      isUnread: true,
    });
    const sent = makeThread("one@example.com", "sent", 350, {
      isUnread: true,
      labels: ["SENT"],
    });
    const sentTrash = makeThread("one@example.com", "sent-trash", 325, {
      labels: ["SENT", "TRASH"],
    });

    expect(
      filterThreadsByScope(
        [unread, read, sent, sentTrash, trashed, otherAccount],
        ["one@example.com"],
        true
      )
    ).toStrictEqual([unread, sent]);
    expect(
      filterThreadsByScope(
        [unread, read, sent, sentTrash, trashed, otherAccount],
        ["one@example.com"],
        false,
        "sent"
      )
    ).toStrictEqual([sent]);
    expect(
      filterThreadsByScope(
        [unread, read, sent, sentTrash, trashed, otherAccount],
        ["one@example.com"],
        false,
        "trash"
      )
    ).toStrictEqual([sentTrash, trashed]);
  });

  it("keeps Spam separate from Inbox for colliding thread ids", () => {
    const inbox = makeThread("one@example.com", "shared", 300);
    const spam = makeThread("two@example.com", "shared", 200, {
      isUnread: true,
      labels: ["SPAM", "UNREAD"],
    });

    expect(
      filterThreadsByScope(
        [inbox, spam],
        ["one@example.com", "two@example.com"],
        false,
        "spam"
      )
    ).toStrictEqual([spam]);
  });

  it("shows a label's conversations outside Spam and Trash", () => {
    const archived = makeThread("one@example.com", "archived", 400, {
      labels: ["Work"],
    });
    const inbox = makeThread("one@example.com", "inbox", 300, {
      labels: ["INBOX", "work"],
    });
    const trashed = makeThread("one@example.com", "trashed", 200, {
      labels: ["TRASH", "Work"],
    });
    const other = makeThread("one@example.com", "other", 100, {
      labels: ["INBOX", "Work/Clients"],
    });
    const otherAccount = makeThread("two@example.com", "archived", 50, {
      labels: ["Work"],
    });

    expect(
      filterThreadsByScope(
        [archived, inbox, trashed, other, otherAccount],
        ["one@example.com"],
        false,
        { label: "Work" }
      )
    ).toStrictEqual([archived, inbox]);
  });
});

describe("mailbox place request scope", () => {
  it("sends a label place and keys it apart from a mailbox", () => {
    expect(
      createCachedThreadPageRequest(["one@example.com"], false, {
        label: "Work",
      })
    ).toStrictEqual({
      accountIds: ["one@example.com"],
      cursor: undefined,
      mailbox: { label: "Work" },
      unreadOnly: undefined,
    });
    expect(
      getMailboxScopeKey(["one@example.com"], false, { label: "work" })
    ).toBe(getMailboxScopeKey(["one@example.com"], false, { label: "WORK" }));
    expect(
      getMailboxScopeKey(["one@example.com"], false, { label: "Sent" })
    ).not.toBe(getMailboxScopeKey(["one@example.com"], false, "sent"));
  });
});
