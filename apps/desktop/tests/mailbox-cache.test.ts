import { beforeEach, describe, expect, it } from "@effect/vitest";

import type { MailboxThreadsSnapshot } from "../src/renderer/src/mail/mailbox-cache";
import {
  clearMailboxThreadsSnapshots,
  getMailboxThreadsSnapshot,
  retainMailboxThreadsSnapshotsForAccounts,
  setMailboxThreadsSnapshot,
  updateMailboxThreadsSnapshots,
} from "../src/renderer/src/mail/mailbox-cache";
import {
  filterThreadsByScope,
  getMailboxScopeKey,
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

  it("hides a trashed thread upsert from visible inbox snapshots", () => {
    const scopeKey = getMailboxScopeKey(["account@example.com"], false);
    const thread = makeThread();

    setMailboxThreadsSnapshot(scopeKey, {
      ...makeSnapshot(scopeKey),
      threads: [thread],
    });
    updateMailboxThreadsSnapshots([
      {
        kind: "upsert",
        thread: { ...thread, labels: ["TRASH"] },
      },
    ]);

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

  it("adds incoming threads only to snapshots containing their account", () => {
    const accountScopeKey = getMailboxScopeKey(["account@example.com"], false);
    const otherScopeKey = getMailboxScopeKey(["other@example.com"], false);
    const incoming = makeThread();

    setMailboxThreadsSnapshot(accountScopeKey, makeSnapshot(accountScopeKey));
    setMailboxThreadsSnapshot(otherScopeKey, makeSnapshot(otherScopeKey));
    updateMailboxThreadsSnapshots([{ kind: "upsert", thread: incoming }]);

    expect(getMailboxThreadsSnapshot(accountScopeKey)?.threads).toStrictEqual([
      incoming,
    ]);
    expect(getMailboxThreadsSnapshot(otherScopeKey)?.threads).toStrictEqual([]);
  });

  it("removes threads deleted by an external sync", () => {
    const scopeKey = getMailboxScopeKey(["account@example.com"], false);
    const thread = makeThread();

    setMailboxThreadsSnapshot(scopeKey, {
      ...makeSnapshot(scopeKey),
      threads: [thread],
    });
    updateMailboxThreadsSnapshots([
      {
        accountId: thread.accountId,
        kind: "remove",
        threadId: thread.threadId,
      },
    ]);

    expect(getMailboxThreadsSnapshot(scopeKey)?.threads).toStrictEqual([]);
  });

  it("invalidates relevant snapshots when an authoritative reload is needed", () => {
    const accountScopeKey = getMailboxScopeKey(["account@example.com"], false);
    const otherScopeKey = getMailboxScopeKey(["other@example.com"], false);

    setMailboxThreadsSnapshot(accountScopeKey, makeSnapshot(accountScopeKey));
    setMailboxThreadsSnapshot(otherScopeKey, makeSnapshot(otherScopeKey));
    updateMailboxThreadsSnapshots([
      { accountId: "account@example.com", kind: "reload" },
    ]);

    expect(getMailboxThreadsSnapshot(accountScopeKey)).toBeUndefined();
    expect(getMailboxThreadsSnapshot(otherScopeKey)).toBeDefined();
  });
});
