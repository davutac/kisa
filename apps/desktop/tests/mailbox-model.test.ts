import { describe, expect, it } from "@effect/vitest";

import {
  filterThreadsByScope,
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
