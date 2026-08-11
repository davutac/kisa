import { useCallback, useEffect, useRef, useState } from "react";

import { getMailApi } from "@/platform/desktop";
import type {
  GmailMailbox,
  GmailThreadCursor,
  GmailThreadSummary,
} from "@/shared/ipc/mail";

import type { MailboxThreadsSnapshot } from "./mailbox-cache";
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

interface MailboxThreadsState {
  hasNextPage: boolean;
  isInitialLoading: boolean;
  isLoadingNextPage: boolean;
  loadNextPage: () => Promise<boolean>;
  threads: readonly GmailThreadSummary[];
}

interface MailboxThreadsOptions {
  accountIds: readonly string[];
  mailbox?: GmailMailbox;
  reloadRevision?: number;
  unreadOnly?: boolean;
}

type MailboxThreadsResult = MailboxThreadsSnapshot;

/**
 * Mailbox lists come only from the local cache. Searching lives in the palette,
 * over the local index — this hook never queries Gmail, so each mailbox is one
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
        createCachedThreadPageRequest(accountIds, unreadOnly, mailbox)
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

    const unsubscribeThreadList = mailApi.onThreadListUpdated(({ changes }) => {
      updateMailboxThreadsSnapshots(changes);

      const relevantChanges = changes.filter((change) =>
        accountIds.includes(getThreadListChangeAccountId(change))
      );

      if (relevantChanges.length === 0) {
        return;
      }

      const preciseChanges = relevantChanges.filter(
        (change) => change.kind !== "reload"
      );

      if (preciseChanges.length > 0) {
        setResult((current) => ({
          ...current,
          threads: applyThreadListChanges(current.threads, preciseChanges),
        }));
      }

      if (relevantChanges.some((change) => change.kind === "reload")) {
        void loadCachedFirstPage(false);
      }
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
        mailbox,
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
  }, [accountIds, mailApi, mailbox, scopeKey, unreadOnly]);

  return {
    hasNextPage: currentResult.cacheCursor !== null,
    isInitialLoading: currentResult.isInitialLoading,
    isLoadingNextPage: currentResult.isLoadingNextPage,
    loadNextPage,
    threads: currentResult.threads,
  };
};
