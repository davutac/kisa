import { useCallback, useEffect, useRef, useState } from "react";

import { getMailApi } from "@/platform/desktop";
import type { GmailThreadCursor, GmailThreadSummary } from "@/shared/ipc/mail";

import type { MailboxThreadsSnapshot } from "./mailbox-cache";
import {
  getMailboxThreadsSnapshot,
  patchMailboxThreadsSnapshots,
  setMailboxThreadsSnapshot,
} from "./mailbox-cache";
import type { ThreadPatch } from "./mailbox-model";
import {
  createCachedThreadPageRequest,
  filterThreadsByScope,
  getMailboxScopeKey,
  mergeAndSortThreads,
  patchThreads,
  toThreadCursor,
} from "./mailbox-model";

interface MailboxThreadsState {
  hasNextPage: boolean;
  isInitialLoading: boolean;
  isLoadingNextPage: boolean;
  loadNextPage: () => Promise<boolean>;
  patchThread: (threadKey: string, patch: ThreadPatch) => void;
  threads: readonly GmailThreadSummary[];
}

type MailboxThreadsResult = MailboxThreadsSnapshot;

/**
 * The mailbox list is the cached inbox and nothing else. Searching lives in the
 * palette, over the local index — this hook never queries Gmail, so a mailbox
 * is one keyset walk through rows that are already on disk.
 */
export const useMailboxThreads = (
  accountIds: readonly string[],
  unreadOnly = false,
  reloadRevision = 0
): MailboxThreadsState => {
  const mailApi = getMailApi();
  const scopeKey = getMailboxScopeKey(accountIds, unreadOnly);
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
  const cacheCursorRef = useRef<GmailThreadCursor | null>(result.cacheCursor);
  const generationRef = useRef(0);
  const isLoadingNextPageRef = useRef(false);
  const reloadRevisionRef = useRef(reloadRevision);
  const resultRef = useRef(result);
  const threadsRef = useRef<readonly GmailThreadSummary[]>(result.threads);

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
      const reply = await mailApi.listCachedThreadPage(
        createCachedThreadPageRequest(accountIds, unreadOnly)
      );

      if (!(isActive && generationRef.current === generation)) {
        return;
      }

      if (!reply.ok) {
        setResult((current) => ({
          ...current,
          isInitialLoading: false,
          isLoadingNextPage: false,
        }));
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

    const unsubscribe = mailApi.onThreadsChanged(({ accountId }) => {
      if (accountIds.includes(accountId)) {
        void loadCachedFirstPage(true);
      }
    });

    void loadCachedFirstPage(cachedResult !== undefined);

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [accountIds, mailApi, reloadRevision, scopeKey, unreadOnly]);

  const isCurrentScope = result.scopeKey === scopeKey;
  const scopedThreads = filterThreadsByScope(
    result.threads,
    accountIds,
    unreadOnly
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

    if (result.scopeKey === scopeKey) {
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
        ? { ...current, isLoadingNextPage: true }
        : current
    );

    const tailThread = threadsRef.current.at(-1);
    const reply = await mailApi.listCachedThreadPage(
      createCachedThreadPageRequest(
        accountIds,
        unreadOnly,
        tailThread === undefined ? cacheCursor : toThreadCursor(tailThread)
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
    setResult((current) =>
      current.scopeKey === scopeKey
        ? {
            ...current,
            cacheCursor: nextCacheCursor,
            isLoadingNextPage: false,
            threads: reply.ok
              ? mergeAndSortThreads(current.threads, reply.data.threads)
              : current.threads,
          }
        : current
    );
    return reply.ok;
  }, [accountIds, mailApi, scopeKey, unreadOnly]);

  const patchThread = useCallback(
    (threadKey: string, patch: ThreadPatch): void => {
      patchMailboxThreadsSnapshots(threadKey, patch);
      setResult((current) => ({
        ...current,
        threads: patchThreads(current.threads, threadKey, patch),
      }));
    },
    []
  );

  return {
    hasNextPage: currentResult.cacheCursor !== null,
    isInitialLoading: currentResult.isInitialLoading,
    isLoadingNextPage: currentResult.isLoadingNextPage,
    loadNextPage,
    patchThread,
    threads: currentResult.threads,
  };
};
