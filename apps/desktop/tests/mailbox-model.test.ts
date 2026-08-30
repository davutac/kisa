import { describe, expect, it } from "@effect/vitest";

import {
  createCachedThreadPageRequest,
  filterThreadsByScope,
  getMailboxScopeKey,
  mergeAndSortThreads,
} from "../src/renderer/src/mail/mailbox-model";
import type { GmailThreadSummary } from "../src/shared/ipc/mail";

const makeThread = (
  accountId: string,
  threadId: string,
  latestAt: number,
  overrides: Partial<GmailThreadSummary> = {}
): GmailThreadSummary => ({
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

  it("requires every selected mailbox label", () => {
    const both = makeThread("one@example.com", "both", 300, {
      labels: ["INBOX", "Work", "Travel"],
    });
    const one = makeThread("one@example.com", "one", 200, {
      labels: ["INBOX", "Work"],
    });

    expect(
      filterThreadsByScope([both, one], ["one@example.com"], false, "inbox", [
        "travel",
        "work",
      ])
    ).toStrictEqual([both]);
  });
});

describe("mailbox label request scope", () => {
  it("normalizes labels in requests and cache keys", () => {
    expect(
      createCachedThreadPageRequest(["one@example.com"], false, "inbox", [
        " Work ",
        "travel",
        "WORK",
      ])
    ).toStrictEqual({
      accountIds: ["one@example.com"],
      cursor: undefined,
      labelNames: ["travel", "work"],
      mailbox: "inbox",
      unreadOnly: undefined,
    });
    expect(
      getMailboxScopeKey(["one@example.com"], false, "inbox", [
        "work",
        "travel",
      ])
    ).toBe(
      getMailboxScopeKey(["one@example.com"], false, "inbox", [
        "Travel",
        "WORK",
      ])
    );
  });
});
