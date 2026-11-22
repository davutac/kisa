import { describe, expect, it } from "vitest";

import type { MailboxThreadsLoad } from "../src/renderer/src/mail/mailbox-threads-load";
import {
  failMailboxLoad,
  getThreadListPlaceholder,
  retryMailboxLoad,
  shouldLoadNextPage,
} from "../src/renderer/src/mail/mailbox-threads-load";
import type { MailThreadSummary } from "../src/shared/ipc/mail";

const thread = { accountId: "person@example.com", threadId: "thread-1" };

const load = (patch: Partial<MailboxThreadsLoad> = {}): MailboxThreadsLoad => ({
  cacheCursor: null,
  isInitialLoading: false,
  isLoadingNextPage: false,
  scopeKey: "inbox",
  threads: [],
  ...patch,
});

const atLastRow = {
  hasLoadError: false,
  hasNextPage: true,
  isLoadingNextPage: false,
  lastVisibleIndex: 49,
  threadCount: 50,
};

const withoutRows = (hasLoadError: boolean, isInitialLoading: boolean) =>
  getThreadListPlaceholder({ hasLoadError, isInitialLoading, threadCount: 0 });

describe("mailbox list load", () => {
  it("shows a failed first load as a failure, not as an empty mailbox", () => {
    expect(withoutRows(true, false)).toBe("failed");
    expect(withoutRows(false, false)).toBe("empty");
    expect(withoutRows(false, true)).toBe("loading");
    expect(
      getThreadListPlaceholder({
        hasLoadError: true,
        isInitialLoading: false,
        threadCount: 3,
      })
    ).toBeUndefined();
  });

  it("stops asking for the next page after a failed load until it is retried", () => {
    expect(shouldLoadNextPage(atLastRow)).toBeTruthy();
    expect(
      shouldLoadNextPage({ ...atLastRow, hasLoadError: true })
    ).toBeFalsy();
    expect(
      shouldLoadNextPage({ ...atLastRow, isLoadingNextPage: true })
    ).toBeFalsy();
    expect(
      shouldLoadNextPage({ ...atLastRow, hasNextPage: false })
    ).toBeFalsy();
    expect(
      shouldLoadNextPage({ ...atLastRow, lastVisibleIndex: 12 })
    ).toBeFalsy();
  });

  it("keeps the rows and its place in the list when a load fails", () => {
    const cursor = { latestAt: 1, threadId: "thread-1" } as never;
    const loading = load({
      cacheCursor: cursor,
      isLoadingNextPage: true,
      threads: [thread as MailThreadSummary],
    });
    const error = {
      message: "Could not load mail",
      source: "next-page",
    } as const;

    expect(failMailboxLoad(loading, "inbox", error)).toStrictEqual({
      ...loading,
      error,
      isLoadingNextPage: false,
    });
    expect(failMailboxLoad(loading, "sent", error)).toBe(loading);
  });

  it("clears the failure on a retry and shows loading only while there are no rows", () => {
    const error = {
      message: "Could not load mail",
      source: "first-page",
    } as const;
    const failedEmpty = load({ error });
    const failedWithRows = load({
      error,
      threads: [thread as MailThreadSummary],
    });

    expect(retryMailboxLoad(failedEmpty, "inbox")).toMatchObject({
      error: undefined,
      isInitialLoading: true,
    });
    expect(retryMailboxLoad(failedWithRows, "inbox")).toMatchObject({
      error: undefined,
      isInitialLoading: false,
    });
    expect(retryMailboxLoad(failedEmpty, "sent")).toBe(failedEmpty);
  });
});
