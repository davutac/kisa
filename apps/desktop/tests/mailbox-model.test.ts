import { describe, expect, it } from "@effect/vitest";

import {
  advanceThreadPages,
  filterThreadsByScope,
  getGmailQuery,
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
  it("keeps Inbox threads for the selected accounts and unread scope", () => {
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

    expect(
      filterThreadsByScope(
        [unread, read, trashed, otherAccount],
        ["one@example.com"],
        true
      )
    ).toStrictEqual([unread]);
  });
});

describe(getGmailQuery, () => {
  it("normalizes search text and composes the unread filter", () => {
    expect(getGmailQuery("  from:sender@example.com  ", true)).toBe(
      "from:sender@example.com is:unread"
    );
    expect(getGmailQuery("   ", false)).toBe("");
  });
});

describe(advanceThreadPages, () => {
  it("preserves failed cursors, removes exhausted cursors, and advances others", () => {
    const currentTokens = new Map([
      ["failed@example.com", "failed-token"],
      ["finished@example.com", "finished-token"],
      ["more@example.com", "more-token"],
    ]);
    const loadedThread = makeThread("more@example.com", "loaded", 500);

    const result = advanceThreadPages(
      currentTokens,
      [...currentTokens],
      [
        { error: "Network unavailable", ok: false },
        { data: { threads: [] }, ok: true },
        {
          data: { nextPageToken: "next-token", threads: [loadedThread] },
          ok: true,
        },
      ]
    );

    expect([...result.nextPageTokens]).toStrictEqual([
      ["failed@example.com", "failed-token"],
      ["more@example.com", "next-token"],
    ]);
    expect(result.threads).toStrictEqual([loadedThread]);
  });
});
