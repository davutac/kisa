import { beforeEach, describe, expect, it } from "@effect/vitest";

import type { MailboxThreadsSnapshot } from "../src/renderer/src/mail/mailbox-cache";
import {
  clearMailboxThreadsSnapshots,
  getMailboxThreadsSnapshot,
  retainMailboxThreadsSnapshotsForAccounts,
  setMailboxThreadsSnapshot,
} from "../src/renderer/src/mail/mailbox-cache";
import { getMailboxScopeKey } from "../src/renderer/src/mail/mailbox-model";
import { requestMailboxReload } from "../src/renderer/src/mail/mailbox-reload";

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
});
