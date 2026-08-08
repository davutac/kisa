import { beforeEach, describe, expect, it } from "@effect/vitest";

import type { MailboxThreadsSnapshot } from "../src/renderer/src/mail/mailbox-cache";
import {
  clearMailboxThreadsSnapshots,
  getMailboxThreadsSnapshot,
  patchMailboxThreadsSnapshots,
  retainMailboxThreadsSnapshotsForAccounts,
  setMailboxThreadsSnapshot,
} from "../src/renderer/src/mail/mailbox-cache";
import {
  filterThreadsByScope,
  getMailboxScopeKey,
  toTrashedThread,
} from "../src/renderer/src/mail/mailbox-model";
import { requestMailboxReload } from "../src/renderer/src/mail/mailbox-reload";
import type { GmailThreadSummary } from "../src/shared/ipc/mail";

const makeSnapshot = (scopeKey: string): MailboxThreadsSnapshot => ({
  cacheCursor: {
    accountId: "account@example.com",
    latestAt: 100,
    threadId: "thread-1",
  },
  isInitialLoading: false,
  isLoadingNextPage: true,
  scopeKey,
  threads: [],
});

const makeThread = (): GmailThreadSummary => ({
  accountId: "account@example.com",
  attachments: [],
  from: "Sender <sender@example.com>",
  hasAttachments: false,
  isUnread: false,
  labels: ["INBOX"],
  latestAt: 100,
  messageCount: 1,
  snippet: "Snippet",
  subject: "Subject",
  threadId: "thread-1",
});

describe("mailbox thread snapshots", () => {
  beforeEach(() => {
    clearMailboxThreadsSnapshots();
  });

  it("hands a stored snapshot back with its loading flag settled", () => {
    const scopeKey = "mailbox-cache-test";
    const snapshot = makeSnapshot(scopeKey);

    setMailboxThreadsSnapshot(scopeKey, snapshot);

    expect(getMailboxThreadsSnapshot(scopeKey)).toStrictEqual({
      ...snapshot,
      isLoadingNextPage: false,
    });
  });

  it("clears loaded snapshots when a mailbox reload is requested", () => {
    const key = "reload-mailbox";

    setMailboxThreadsSnapshot(key, makeSnapshot(key));
    requestMailboxReload();

    expect(getMailboxThreadsSnapshot(key)).toBeUndefined();
  });

  it("retains only snapshots matching the account being switched to", () => {
    const firstAccountKey = getMailboxScopeKey(["first@example.com"], false);
    const secondAccountKey = getMailboxScopeKey(["second@example.com"], false);
    const allAccountsKey = getMailboxScopeKey(
      ["first@example.com", "second@example.com"],
      false
    );

    setMailboxThreadsSnapshot(firstAccountKey, makeSnapshot(firstAccountKey));
    setMailboxThreadsSnapshot(secondAccountKey, makeSnapshot(secondAccountKey));
    setMailboxThreadsSnapshot(allAccountsKey, makeSnapshot(allAccountsKey));

    retainMailboxThreadsSnapshotsForAccounts(["second@example.com"]);

    expect(getMailboxThreadsSnapshot(firstAccountKey)).toBeUndefined();
    expect(getMailboxThreadsSnapshot(secondAccountKey)).toBeDefined();
    expect(getMailboxThreadsSnapshot(allAccountsKey)).toBeUndefined();
  });

  it("removes a locally trashed thread from visible inbox snapshots", () => {
    const scopeKey = getMailboxScopeKey(["account@example.com"], false);
    const thread = makeThread();

    setMailboxThreadsSnapshot(scopeKey, {
      ...makeSnapshot(scopeKey),
      threads: [thread],
    });
    patchMailboxThreadsSnapshots(
      `${thread.accountId}:${thread.threadId}`,
      toTrashedThread
    );

    const snapshot = getMailboxThreadsSnapshot(scopeKey);

    expect(snapshot).toBeDefined();
    expect(
      filterThreadsByScope(
        snapshot?.threads ?? [],
        ["account@example.com"],
        false
      )
    ).toStrictEqual([]);
  });
});
