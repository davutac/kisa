import { useCallback, useEffect, useRef, useState } from "react";

import { getMailApi } from "@/platform/desktop";
import type { GmailThreadCursor, GmailThreadSummary } from "@/shared/ipc/mail";

import type { MailboxThreadsSnapshot } from "./mailbox-cache";
import {
  getMailboxCacheKey,
  getMailboxThreadsSnapshot,
  patchMailboxThreadsSnapshots,
  setMailboxThreadsSnapshot,
} from "./mailbox-cache";
import type { ThreadPatch } from "./mailbox-model";
import {
  advanceThreadPages,
  createCachedThreadPageRequest,
  createGmailThreadPageRequest,
  filterThreadsByScope,
  getGmailQuery,
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

export const useMailboxThreads = (
  accountIds: readonly string[],
  query: string,
  unreadOnly = false,
  reloadRevision = 0
): MailboxThreadsState => {
  const mailApi = getMailApi();
  const normalizedQuery = query.trim();
  const gmailQuery = getGmailQuery(normalizedQuery, unreadOnly);
  const scopeKey = getMailboxScopeKey(accountIds, unreadOnly);
  const resultKey = getMailboxCacheKey(scopeKey, normalizedQuery);
  const createStartingResult = (): MailboxThreadsResult =>
    getMailboxThreadsSnapshot(resultKey) ?? {
      cacheCursor: null,
      isInitialLoading: mailApi !== undefined,
      isLoadingNextPage: false,
      nextPageTokens: new Map(),
      query: normalizedQuery,
      scopeKey,
      threads: [],
    };
  const [result, setResult] =
    useState<MailboxThreadsResult>(createStartingResult);
  const [resultKeyInState, setResultKeyInState] = useState(resultKey);
  const cacheCursorRef = useRef<GmailThreadCursor | null>(result.cacheCursor);
  const generationRef = useRef(0);
  const isLoadingNextPageRef = useRef(false);
  const reloadRevisionRef = useRef(reloadRevision);
  const resultRef = useRef(result);
  const nextPageTokensRef = useRef<ReadonlyMap<string, string>>(
    result.nextPageTokens
  );
  const threadsRef = useRef<readonly GmailThreadSummary[]>(result.threads);

  if (resultKeyInState !== resultKey) {
    setResultKeyInState(resultKey);
    setResult(createStartingResult());
  }

  useEffect(() => {
    const generation = generationRef.current + 1;
    const isReload = reloadRevisionRef.current !== reloadRevision;
    const liveResult = resultRef.current;
    const cachedResult =
      getMailboxThreadsSnapshot(resultKey) ??
      (isReload &&
      liveResult.query === normalizedQuery &&
      liveResult.scopeKey === scopeKey
        ? liveResult
        : undefined);
    const startingResult = cachedResult ?? {
      cacheCursor: null,
      isInitialLoading: mailApi !== undefined,
      isLoadingNextPage: false,
      nextPageTokens: new Map<string, string>(),
      query: normalizedQuery,
      scopeKey,
      threads: [],
    };

    generationRef.current = generation;
    reloadRevisionRef.current = reloadRevision;
    cacheCursorRef.current = startingResult.cacheCursor;
    isLoadingNextPageRef.current = false;
    nextPageTokensRef.current = startingResult.nextPageTokens;
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
        nextPageTokens: merge ? current.nextPageTokens : new Map(),
        query: normalizedQuery,
        scopeKey,
        threads:
          merge &&
          current.query === normalizedQuery &&
          current.scopeKey === scopeKey
            ? mergeAndSortThreads(current.threads, reply.data.threads)
            : reply.data.threads,
      }));
    };
    const loadSearchFirstPages = async (merge: boolean): Promise<void> => {
      const pageReplies = await Promise.all(
        accountIds.map((accountId) =>
          mailApi.loadThreadPage(
            createGmailThreadPageRequest(accountId, gmailQuery)
          )
        )
      );

      if (!(isActive && generationRef.current === generation)) {
        return;
      }

      const nextPageTokens = new Map<string, string>();
      const pageThreads = pageReplies.flatMap((reply, index) => {
        if (!reply.ok) {
          return [];
        }

        const accountId = accountIds[index];

        if (accountId !== undefined && reply.data.nextPageToken !== undefined) {
          nextPageTokens.set(accountId, reply.data.nextPageToken);
        }

        return reply.data.threads;
      });

      const mergedNextPageTokens = merge
        ? nextPageTokensRef.current
        : nextPageTokens;

      nextPageTokensRef.current = mergedNextPageTokens;

      setResult((current) => ({
        cacheCursor: null,
        isInitialLoading: false,
        isLoadingNextPage: false,
        nextPageTokens: mergedNextPageTokens,
        query: normalizedQuery,
        scopeKey,
        threads:
          merge &&
          current.query === normalizedQuery &&
          current.scopeKey === scopeKey
            ? mergeAndSortThreads(current.threads, pageThreads)
            : mergeAndSortThreads(pageThreads),
      }));
    };

    const unsubscribe = mailApi.onThreadsChanged(({ accountId }) => {
      if (normalizedQuery.length === 0 && accountIds.includes(accountId)) {
        void loadCachedFirstPage(true);
      }
    });

    if (normalizedQuery.length === 0) {
      void loadCachedFirstPage(cachedResult !== undefined);
    } else if (cachedResult === undefined) {
      void loadSearchFirstPages(false);
    } else if (isReload) {
      void loadSearchFirstPages(true);
    }

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [
    accountIds,
    gmailQuery,
    mailApi,
    normalizedQuery,
    reloadRevision,
    resultKey,
    scopeKey,
    unreadOnly,
  ]);

  const isCurrentScope =
    result.query === normalizedQuery && result.scopeKey === scopeKey;
  const scopedThreads =
    result.query === normalizedQuery
      ? filterThreadsByScope(result.threads, accountIds, unreadOnly)
      : [];
  const currentResult =
    result.query === normalizedQuery
      ? {
          ...result,
          cacheCursor: isCurrentScope ? result.cacheCursor : null,
          isInitialLoading: isCurrentScope
            ? result.isInitialLoading
            : scopedThreads.length === 0 && mailApi !== undefined,
          isLoadingNextPage: isCurrentScope && result.isLoadingNextPage,
          nextPageTokens: isCurrentScope
            ? new Map(
                [...result.nextPageTokens].filter(([accountId]) =>
                  accountIds.includes(accountId)
                )
              )
            : new Map<string, string>(),
          threads: scopedThreads,
        }
      : {
          cacheCursor: null,
          isInitialLoading: mailApi !== undefined,
          isLoadingNextPage: false,
          nextPageTokens: new Map<string, string>(),
          query: normalizedQuery,
          scopeKey,
          threads: [],
        };

  useEffect(() => {
    threadsRef.current = currentResult.threads;
  }, [currentResult.threads]);

  useEffect(() => {
    resultRef.current = result;

    if (result.query === normalizedQuery && result.scopeKey === scopeKey) {
      setMailboxThreadsSnapshot(resultKey, result);
    }
  }, [normalizedQuery, result, resultKey, scopeKey]);

  const loadNextPage = useCallback(async (): Promise<boolean> => {
    const cacheCursor = cacheCursorRef.current;
    const pageTokens = nextPageTokensRef.current;

    if (isLoadingNextPageRef.current) {
      return true;
    }

    if (
      mailApi === undefined ||
      (cacheCursor === null && pageTokens.size === 0)
    ) {
      return false;
    }

    const generation = generationRef.current;
    isLoadingNextPageRef.current = true;
    setResult((current) =>
      current.query === normalizedQuery && current.scopeKey === scopeKey
        ? { ...current, isLoadingNextPage: true }
        : current
    );

    if (normalizedQuery.length === 0 && cacheCursor !== null) {
      const cachedReply = await mailApi.listCachedThreadPage(
        createCachedThreadPageRequest(accountIds, unreadOnly, cacheCursor)
      );

      if (generationRef.current !== generation) {
        return false;
      }

      const nextCacheCursor = cachedReply.ok
        ? (cachedReply.data.nextCursor ?? null)
        : cacheCursorRef.current;

      cacheCursorRef.current = nextCacheCursor;
      isLoadingNextPageRef.current = false;
      setResult((current) =>
        current.query === normalizedQuery && current.scopeKey === scopeKey
          ? {
              ...current,
              cacheCursor: nextCacheCursor,
              isLoadingNextPage: false,
              threads: cachedReply.ok
                ? mergeAndSortThreads(current.threads, cachedReply.data.threads)
                : current.threads,
            }
          : current
      );
      return cachedReply.ok;
    }

    const pageTokenEntries = [...pageTokens];
    const pageReplies = await Promise.all(
      pageTokenEntries.map(([accountId, pageToken]) =>
        mailApi.loadThreadPage(
          createGmailThreadPageRequest(accountId, gmailQuery, pageToken)
        )
      )
    );

    if (generationRef.current !== generation) {
      return false;
    }

    const { nextPageTokens, threads: pageThreads } = advanceThreadPages(
      pageTokens,
      pageTokenEntries,
      pageReplies
    );

    nextPageTokensRef.current = nextPageTokens;

    if (normalizedQuery.length === 0) {
      const tailThread = threadsRef.current.at(-1);
      const cachedReply = await mailApi.listCachedThreadPage(
        createCachedThreadPageRequest(
          accountIds,
          unreadOnly,
          tailThread === undefined ? undefined : toThreadCursor(tailThread)
        )
      );

      if (generationRef.current !== generation) {
        return false;
      }

      const nextCacheCursor = cachedReply.ok
        ? (cachedReply.data.nextCursor ?? null)
        : cacheCursorRef.current;

      cacheCursorRef.current = nextCacheCursor;
      isLoadingNextPageRef.current = false;
      setResult((current) =>
        current.query === normalizedQuery && current.scopeKey === scopeKey
          ? {
              ...current,
              cacheCursor: nextCacheCursor,
              isLoadingNextPage: false,
              nextPageTokens,
              threads: mergeAndSortThreads(
                current.threads,
                cachedReply.ok ? cachedReply.data.threads : pageThreads
              ),
            }
          : current
      );
      return cachedReply.ok || pageReplies.some((reply) => reply.ok);
    }

    isLoadingNextPageRef.current = false;
    setResult((current) =>
      current.query === normalizedQuery && current.scopeKey === scopeKey
        ? {
            ...current,
            isLoadingNextPage: false,
            nextPageTokens,
            threads: mergeAndSortThreads(current.threads, pageThreads),
          }
        : current
    );
    return pageReplies.some((reply) => reply.ok);
  }, [accountIds, gmailQuery, mailApi, normalizedQuery, scopeKey, unreadOnly]);

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
    hasNextPage:
      currentResult.cacheCursor !== null ||
      currentResult.nextPageTokens.size > 0,
    isInitialLoading: currentResult.isInitialLoading,
    isLoadingNextPage: currentResult.isLoadingNextPage,
    loadNextPage,
    patchThread,
    threads: currentResult.threads,
  };
};
