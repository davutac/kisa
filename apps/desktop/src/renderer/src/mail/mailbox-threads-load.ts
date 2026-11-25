import type { MailboxThreadsSnapshot } from "./mailbox-cache";

export interface MailboxLoadError {
  readonly message: string;
  /** Which request failed, because a retry repeats that one. */
  readonly source: "first-page" | "next-page";
}

/**
 * A mailbox list as its hook holds it. The failure lives only here, never in
 * the snapshot cache, so it cannot reappear later or under another mailbox.
 */
export interface MailboxThreadsLoad extends MailboxThreadsSnapshot {
  error?: MailboxLoadError;
}

/** Keeps the rows and the paging position: a failed load loses neither. */
export const failMailboxLoad = (
  current: MailboxThreadsLoad,
  scopeKey: string,
  error: MailboxLoadError
): MailboxThreadsLoad =>
  current.scopeKey === scopeKey
    ? { ...current, error, isInitialLoading: false, isLoadingNextPage: false }
    : current;

export const retryMailboxLoad = (
  current: MailboxThreadsLoad,
  scopeKey: string
): MailboxThreadsLoad =>
  current.scopeKey === scopeKey && current.error !== undefined
    ? {
        ...current,
        error: undefined,
        isInitialLoading:
          current.error.source === "first-page" && current.threads.length === 0,
      }
    : current;

export type ThreadListPlaceholder = "empty" | "failed" | "loading";

/** What a list without rows shows. A failed load is not an empty mailbox. */
export const getThreadListPlaceholder = ({
  hasLoadError,
  isInitialLoading,
  threadCount,
}: {
  readonly hasLoadError: boolean;
  readonly isInitialLoading: boolean;
  readonly threadCount: number;
}): ThreadListPlaceholder | undefined => {
  if (threadCount > 0) {
    return undefined;
  }

  if (isInitialLoading) {
    return "loading";
  }

  return hasLoadError ? "failed" : "empty";
};

/**
 * Whether reaching the end of the list asks for more. After a failure it does
 * not, until the user retries: the last row stays in view, so asking again on
 * its own would repeat the failing request without pause.
 */
export const shouldLoadNextPage = ({
  hasLoadError,
  hasNextPage,
  isLoadingNextPage,
  lastVisibleIndex,
  threadCount,
}: {
  readonly hasLoadError: boolean;
  readonly hasNextPage: boolean;
  readonly isLoadingNextPage: boolean;
  readonly lastVisibleIndex: number | undefined;
  readonly threadCount: number;
}): boolean =>
  lastVisibleIndex !== undefined &&
  lastVisibleIndex >= threadCount - 1 &&
  hasNextPage &&
  !isLoadingNextPage &&
  !hasLoadError;
