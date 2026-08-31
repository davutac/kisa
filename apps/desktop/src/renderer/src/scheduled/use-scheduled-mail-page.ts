import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getScheduledMailApi } from "@/platform/desktop";
import type { ScheduledMailSummary } from "@/shared/ipc/scheduled-mail";

import { getScheduledMailKey } from "./scheduled-mail-view";

export const useScheduledMailPage = (accountIds: readonly string[]) => {
  const api = useMemo(() => getScheduledMailApi(), []);
  const [items, setItems] = useState<readonly ScheduledMailSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const scopeKey = JSON.stringify(accountIds);
  const [loadedScopeKey, setLoadedScopeKey] = useState(scopeKey);
  const [error, setError] = useState<
    { message: string; scopeKey: string } | undefined
  >();
  const loadMoreInFlightRef = useRef(false);
  const requestRevisionRef = useRef(0);
  const isCurrentScope = loadedScopeKey === scopeKey;
  const visibleItems = isCurrentScope ? items : [];
  const visibleNextCursor = isCurrentScope ? nextCursor : undefined;

  const loadFirstPage = useCallback(async (): Promise<void> => {
    if (api === undefined) {
      setItems([]);
      setNextCursor(undefined);
      setLoadedScopeKey(scopeKey);
      setError({
        message: "Scheduled email is unavailable in this build",
        scopeKey,
      });
      setIsInitialLoading(false);
      return;
    }
    const revision = requestRevisionRef.current + 1;
    requestRevisionRef.current = revision;
    setIsInitialLoading(true);
    try {
      const reply = await api.listPage({ accountIds });
      if (requestRevisionRef.current !== revision) {
        return;
      }
      if (!reply.ok) {
        setError({ message: reply.error, scopeKey });
        return;
      }
      setError(undefined);
      setItems(reply.data.items);
      setLoadedScopeKey(scopeKey);
      setNextCursor(reply.data.nextCursor);
    } catch {
      if (requestRevisionRef.current === revision) {
        setError({ message: "Could not load scheduled emails", scopeKey });
      }
    } finally {
      if (requestRevisionRef.current === revision) {
        setIsInitialLoading(false);
      }
    }
  }, [accountIds, api, scopeKey]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        void loadFirstPage();
      }
    });
    return () => {
      active = false;
    };
  }, [loadFirstPage]);

  useEffect(() => {
    if (api === undefined) {
      return;
    }
    const scope = new Set(accountIds);
    return api.onChanged((change) => {
      if (scope.has(change.accountId)) {
        void loadFirstPage();
      }
    });
  }, [accountIds, api, loadFirstPage]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (
      api === undefined ||
      visibleNextCursor === undefined ||
      loadMoreInFlightRef.current
    ) {
      return;
    }
    const revision = requestRevisionRef.current;
    loadMoreInFlightRef.current = true;
    setIsLoadingMore(true);
    try {
      const reply = await api.listPage({
        accountIds,
        cursor: visibleNextCursor,
      });
      if (requestRevisionRef.current !== revision) {
        return;
      }
      if (!reply.ok) {
        setError({ message: reply.error, scopeKey });
        return;
      }
      setError(undefined);
      setItems((current) => {
        const byKey = new Map(
          current.map((item) => [getScheduledMailKey(item), item] as const)
        );
        for (const item of reply.data.items) {
          byKey.set(getScheduledMailKey(item), item);
        }
        return [...byKey.values()];
      });
      setNextCursor(reply.data.nextCursor);
    } catch {
      if (requestRevisionRef.current === revision) {
        setError({ message: "Could not load more scheduled emails", scopeKey });
      }
    } finally {
      loadMoreInFlightRef.current = false;
      setIsLoadingMore(false);
    }
  }, [accountIds, api, scopeKey, visibleNextCursor]);

  const removeOptimistically = (item: ScheduledMailSummary): void => {
    const key = getScheduledMailKey(item);
    setItems((current) =>
      current.filter((candidate) => getScheduledMailKey(candidate) !== key)
    );
  };

  return {
    api,
    error: error?.scopeKey === scopeKey ? error.message : undefined,
    isInitialLoading: !isCurrentScope || isInitialLoading,
    isLoadingMore: isCurrentScope && isLoadingMore,
    items: visibleItems,
    loadMore,
    nextCursor: visibleNextCursor,
    reload: loadFirstPage,
    removeOptimistically,
  };
};
