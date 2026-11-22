import { useCallback, useEffect, useRef, useState } from "react";

import { getMailApi } from "@/platform/desktop";
import type {
  MailboxPlace,
  MailThreadCursor,
  MailThreadSummary,
} from "@/shared/ipc/mail";

import {
  getMailboxThreadsSnapshot,
  setMailboxThreadsSnapshot,
  updateMailboxThreadsSnapshots,
} from "./mailbox-cache";
import {
  applyThreadListChanges,
  createCachedThreadPageRequest,
  filterThreadsByScope,
  getMailboxScopeKey,
  getThreadListChangeAccountId,
  mergeAndSortThreads,
  toThreadCursor,
} from "./mailbox-model";
import { requestMailboxReload } from "./mailbox-reload";
import { failMailboxLoad, retryMailboxLoad } from "./mailbox-threads-load";
import type { MailboxThreadsLoad } from "./mailbox-threads-load";

interface MailboxThreadsState {
  /** Why the last load failed, until it is retried or the mailbox changes. */
  error?: string;
  hasNextPage: boolean;
  isInitialLoading: boolean;
  isLoadingNextPage: boolean;
  loadNextPage: () => Promise<boolean>;
  /** Repeats the load that failed. */
  retry: () => void;
  threads: readonly MailThreadSummary[];
}

interface MailboxThreadsOptions {
  accountIds: readonly string[];
  mailbox?: MailboxPlace;
  reloadRevision?: number;
  unreadOnly?: boolean;
}

type MailboxThreadsResult = MailboxThreadsLoad;

type CachedThreadPageReply = Awaited<
  ReturnType<NonNullable<ReturnType<typeof getMailApi>>["listCachedThreadPage"]>
>;

/** A rejected bridge call is a failed load, not a load that never ends. */
const settleThreadPage = async (
  request: Promise<CachedThreadPageReply>
): Promise<CachedThreadPageReply> => {
  try {
    return await request;
  } catch {
    return { error: "Could not load mail", ok: false };
  }
};

/**
 * Mailbox lists come only from the local cache. Searching lives in the titlebar,
 * over the local index — this hook never queries the server, so each mailbox is one
 * keyset walk through rows that are already on disk.
 */
export const useMailboxThreads = ({
  accountIds,
  mailbox = "inbox",
  reloadRevision = 0,
  unreadOnly = false,
}: MailboxThreadsOptions): MailboxThreadsState => {
  const mailApi = getMailApi();
  const scopeKey = getMailboxScopeKey(accountIds, unreadOnly, mailbox);
  const createStartingResult = (): MailboxThreadsResult =>
    getMailboxThreadsSnapshot(scopeKey) ?? {
      cacheCursor: null,
      isInitialLoading: mailApi !== undefined,
      isLoadingNextPage: false,
      scopeKey,
      threads: [],
    };
  const [result, setResult] =
    useState<MailboxThreadsResult>(createStartingResult);
  const [scopeKeyInState, setScopeKeyInState] = useState(scopeKey);
  const cacheCursorRef = useRef<MailThreadCursor | null>(result.cacheCursor);
  const generationRef = useRef(0);
  const isLoadingNextPageRef = useRef(false);
  const reloadRevisionRef = useRef(reloadRevision);
  const resultRef = useRef(result);
  const threadsRef = useRef<readonly MailThreadSummary[]>(result.threads);

  if (scopeKeyInState !== scopeKey) {
    setScopeKeyInState(scopeKey);
    setResult(createStartingResult());
  }

  useEffect(() => {
    const generation = generationRef.current + 1;
    const isReload = reloadRevisionRef.current !== reloadRevision;
    const liveResult = resultRef.current;
    const cachedResult =
      getMailboxThreadsSnapshot(scopeKey) ??
      (isReload && liveResult.scopeKey === scopeKey ? liveResult : undefined);
    const startingResult = cachedResult ?? {
      cacheCursor: null,
      isInitialLoading: mailApi !== undefined,
      isLoadingNextPage: false,
      scopeKey,
      threads: [],
    };

    generationRef.current = generation;
    reloadRevisionRef.current = reloadRevision;
    cacheCursorRef.current = startingResult.cacheCursor;
    isLoadingNextPageRef.current = false;
    threadsRef.current = startingResult.threads;

    if (mailApi === undefined) {
      return;
    }

    let isActive = true;
    const loadCachedFirstPage = async (merge: boolean): Promise<void> => {
      setResult((current) => retryMailboxLoad(current, scopeKey));
      const reply = await settleThreadPage(
        mailApi.listCachedThreadPage(
          createCachedThreadPageRequest(accountIds, unreadOnly, mailbox)
        )
      );

      if (!(isActive && generationRef.current === generation)) {
        return;
      }

      if (!reply.ok) {
        setResult((current) =>
          failMailboxLoad(current, scopeKey, {
            message: reply.error,
            source: "first-page",
          })
        );
        return;
      }

      const firstPageCursor = reply.data.nextCursor ?? null;
      const cacheCursor =
        merge && threadsRef.current.length > reply.data.threads.length
          ? cacheCursorRef.current
          : firstPageCursor;

      cacheCursorRef.current = cacheCursor;
      setResult((current) => ({
        cacheCursor,
        isInitialLoading: false,
        isLoadingNextPage: false,
        scopeKey,
        threads:
          merge && current.scopeKey === scopeKey
            ? mergeAndSortThreads(current.threads, reply.data.threads)
            : reply.data.threads,
      }));
    };

    const unsubscribeThreadList = mailApi.onThreadListUpdated(({ changes }) => {
      updateMailboxThreadsSnapshots(changes);

      const relevantChanges = changes.filter((change) =>
        accountIds.includes(getThreadListChangeAccountId(change))
      );

      if (relevantChanges.length === 0) {
        return;
      }

      setResult((current) => ({
        ...current,
        threads: applyThreadListChanges(current.threads, relevantChanges),
      }));
    });

    void loadCachedFirstPage(cachedResult !== undefined);

    return () => {
      isActive = false;
      unsubscribeThreadList();
    };
  }, [accountIds, mailApi, mailbox, reloadRevision, scopeKey, unreadOnly]);

  const isCurrentScope = result.scopeKey === scopeKey;
  const scopedThreads = filterThreadsByScope(
    result.threads,
    accountIds,
    unreadOnly,
    mailbox
  );
  const currentResult = {
    ...result,
    cacheCursor: isCurrentScope ? result.cacheCursor : null,
    isInitialLoading: isCurrentScope
      ? result.isInitialLoading
      : scopedThreads.length === 0 && mailApi !== undefined,
    isLoadingNextPage: isCurrentScope && result.isLoadingNextPage,
    scopeKey,
    threads: scopedThreads,
  };

  useEffect(() => {
    threadsRef.current = currentResult.threads;
  }, [currentResult.threads]);

  useEffect(() => {
    resultRef.current = result;

    // A failed load is never cached: reopening this mailbox loads it afresh.
    if (result.scopeKey === scopeKey && result.error === undefined) {
      setMailboxThreadsSnapshot(scopeKey, result);
    }
  }, [result, scopeKey]);

  const loadNextPage = useCallback(async (): Promise<boolean> => {
    const cacheCursor = cacheCursorRef.current;

    if (isLoadingNextPageRef.current) {
      return true;
    }

    if (mailApi === undefined || cacheCursor === null) {
      return false;
    }

    const generation = generationRef.current;
    isLoadingNextPageRef.current = true;
    setResult((current) =>
      current.scopeKey === scopeKey
        ? { ...current, error: undefined, isLoadingNextPage: true }
        : current
    );

    const tailThread = threadsRef.current.at(-1);
    const reply = await settleThreadPage(
      mailApi.listCachedThreadPage(
        createCachedThreadPageRequest(
          accountIds,
          unreadOnly,
          mailbox,
          tailThread === undefined ? cacheCursor : toThreadCursor(tailThread)
        )
      )
    );

    if (generationRef.current !== generation) {
      return false;
    }

    const nextCacheCursor = reply.ok
      ? (reply.data.nextCursor ?? null)
      : cacheCursorRef.current;

    cacheCursorRef.current = nextCacheCursor;
    isLoadingNextPageRef.current = false;
    setResult((current) => {
      if (!reply.ok) {
        return failMailboxLoad(current, scopeKey, {
          message: reply.error,
          source: "next-page",
        });
      }
      return current.scopeKey === scopeKey
        ? {
            ...current,
            cacheCursor: nextCacheCursor,
            isLoadingNextPage: false,
            threads: mergeAndSortThreads(current.threads, reply.data.threads),
          }
        : current;
    });
    return reply.ok;
  }, [accountIds, mailApi, mailbox, scopeKey, unreadOnly]);

  const retry = useCallback((): void => {
    if (resultRef.current.error?.source === "next-page") {
      void loadNextPage();
      return;
    }
    requestMailboxReload();
  }, [loadNextPage]);

  return {
    error: isCurrentScope ? result.error?.message : undefined,
    hasNextPage: currentResult.cacheCursor !== null,
    isInitialLoading: currentResult.isInitialLoading,
    isLoadingNextPage: currentResult.isLoadingNextPage,
    loadNextPage,
    retry,
    threads: currentResult.threads,
  };
};
