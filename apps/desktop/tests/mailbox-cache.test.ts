import { beforeEach, describe, expect, it } from "@effect/vitest";

import type { MailboxThreadsSnapshot } from "../src/renderer/src/mail/mailbox-cache";
import {
  clearMailboxThreadsSnapshots,
  getMailboxCacheKey,
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
  nextPageTokens: new Map([["account@example.com", "next-page"]]),
  query: "from:sender@example.com",
  scopeKey,
  threads: [],
});

describe("mailbox thread snapshots", () => {
  beforeEach(() => {
    clearMailboxThreadsSnapshots();
  });

  it("keys normalized searches and retains pagination", () => {
    const scopeKey = "mailbox-cache-test";
    const key = getMailboxCacheKey(scopeKey, "  from:sender@example.com  ");
    const snapshot = makeSnapshot(scopeKey);

    setMailboxThreadsSnapshot(key, snapshot);

    expect(key).toBe(`${scopeKey}\u0002from:sender@example.com`);
    expect(getMailboxThreadsSnapshot(key)).toStrictEqual({
      ...snapshot,
      isLoadingNextPage: false,
    });

    expect(getMailboxThreadsSnapshot(key)).toBeDefined();
  });

  it("clears loaded snapshots when a mailbox reload is requested", () => {
    const key = getMailboxCacheKey("reload-mailbox", "");

    setMailboxThreadsSnapshot(key, makeSnapshot("reload-mailbox"));
    requestMailboxReload();

    expect(getMailboxThreadsSnapshot(key)).toBeUndefined();
  });

  it("retains only snapshots matching the account being switched to", () => {
    const firstAccountKey = getMailboxCacheKey(
      getMailboxScopeKey(["first@example.com"], false),
      ""
    );
    const secondAccountKey = getMailboxCacheKey(
      getMailboxScopeKey(["second@example.com"], false),
      ""
    );
    const allAccountsKey = getMailboxCacheKey(
      getMailboxScopeKey(["first@example.com", "second@example.com"], false),
      ""
    );

    setMailboxThreadsSnapshot(
      firstAccountKey,
      makeSnapshot(getMailboxScopeKey(["first@example.com"], false))
    );
    setMailboxThreadsSnapshot(
      secondAccountKey,
      makeSnapshot(getMailboxScopeKey(["second@example.com"], false))
    );
    setMailboxThreadsSnapshot(
      allAccountsKey,
      makeSnapshot(
        getMailboxScopeKey(["first@example.com", "second@example.com"], false)
      )
    );

    retainMailboxThreadsSnapshotsForAccounts(["second@example.com"]);

    expect(getMailboxThreadsSnapshot(firstAccountKey)).toBeUndefined();
    expect(getMailboxThreadsSnapshot(secondAccountKey)).toBeDefined();
    expect(getMailboxThreadsSnapshot(allAccountsKey)).toBeUndefined();
  });
});
