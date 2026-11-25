import { describe, expect, it } from "@effect/vitest";

import {
  createCachedThreadPageRequest,
  filterThreadsByScope,
  getMailboxScopeKey,
  mergeAndSortThreads,
  replaceFirstPage,
  updateListedThreads,
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
  places: ["inbox"],
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
  it("lists a row under each place main sent for it, within the accounts and the unread filter", () => {
    const unread = makeThread("one@example.com", "unread", 300, {
      isUnread: true,
    });
    const read = makeThread("one@example.com", "read", 200);
    const trashed = makeThread("one@example.com", "trashed", 100, {
      isUnread: true,
      labels: ["TRASH"],
      places: ["trash"],
    });
    const otherAccount = makeThread("two@example.com", "other", 400, {
      isUnread: true,
    });
    const sent = makeThread("one@example.com", "sent", 350, {
      isUnread: true,
      labels: ["SENT"],
      places: ["sent"],
    });
    const starredReply = makeThread("one@example.com", "starred", 250, {
      isUnread: true,
      labels: ["SENT", "STARRED"],
      places: ["sent", "starred"],
    });
    const all = [unread, read, sent, starredReply, trashed, otherAccount];
    const listed = (
      unreadOnly: boolean,
      place?: "sent" | "starred" | "trash"
    ) => filterThreadsByScope(all, ["one@example.com"], unreadOnly, place);

    expect({
      inbox: listed(false),
      sent: listed(false, "sent"),
      starred: listed(false, "starred"),
      trash: listed(false, "trash"),
      unreadInbox: listed(true),
    }).toStrictEqual({
      inbox: [unread, read],
      sent: [sent, starredReply],
      starred: [starredReply],
      trash: [trashed],
      unreadInbox: [unread],
    });
  });

  it("keeps Spam separate from Inbox for colliding thread ids", () => {
    const inbox = makeThread("one@example.com", "shared", 300);
    const spam = makeThread("two@example.com", "shared", 200, {
      isUnread: true,
      labels: ["SPAM", "UNREAD"],
      places: ["spam"],
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

  it("lists a label's rows by the label's key, whatever case the place is asked in", () => {
    const filed = makeThread("one@example.com", "filed", 400, {
      labels: ["Work"],
      places: ["label:work"],
    });
    const nested = makeThread("one@example.com", "nested", 100, {
      labels: ["INBOX", "Work/Clients"],
      places: ["inbox", "label:work/clients"],
    });

    expect(
      filterThreadsByScope([filed, nested], ["one@example.com"], false, {
        label: "WORK",
      })
    ).toStrictEqual([filed]);
  });

  // The labels a row shows are names: a user label by its path, a system
  // one by its id. A folder a server calls TRASH reads the same as Trash
  // there, so a list that worked places out from them filed this row under
  // Trash and kept it out of the Inbox.
  it("lists a row by its places where its labels would say otherwise", () => {
    const inFolderCalledTrash = makeThread("one@example.com", "kept", 300, {
      labels: ["INBOX", "TRASH"],
      places: ["inbox", "label:trash"],
    });
    const listed = (place?: "trash" | { readonly label: string }) =>
      filterThreadsByScope(
        [inFolderCalledTrash],
        ["one@example.com"],
        false,
        place
      );

    expect({
      folder: listed({ label: "Trash" }),
      inbox: listed(),
      trash: listed("trash"),
    }).toStrictEqual({
      folder: [inFolderCalledTrash],
      inbox: [inFolderCalledTrash],
      trash: [],
    });
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

describe(updateListedThreads, () => {
  it("updates and drops listed rows but never adds one", () => {
    const kept = makeThread("one@example.com", "thread-1", 300);
    const read = makeThread("one@example.com", "thread-2", 200, {
      isUnread: true,
    });
    const deleted = makeThread("two@example.com", "thread-2", 100);

    expect(
      updateListedThreads(
        [kept, read, deleted],
        [
          { kind: "upsert", thread: { ...read, isUnread: false } },
          {
            accountId: "two@example.com",
            kind: "remove",
            threadId: "thread-2",
          },
          {
            kind: "upsert",
            thread: makeThread("one@example.com", "thread-9", 400),
          },
        ]
      )
    ).toStrictEqual([kept, { ...read, isUnread: false }]);
  });
});
