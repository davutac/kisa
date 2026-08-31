import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getScheduledMailApi } from "@/platform/desktop";
import type { ScheduledMailSummary } from "@/shared/ipc/scheduled-mail";

import {
  getScheduledMailScopeKey,
  getScheduledMailSnapshot,
  invalidateScheduledMailSnapshotsForAccount,
  setScheduledMailSnapshot,
} from "./scheduled-mail-cache";
import { getScheduledMailKey } from "./scheduled-mail-view";

interface ScheduledMailPageState {
  readonly error?: string;
  readonly isInitialLoading: boolean;
  readonly isLoadingMore: boolean;
  readonly items: readonly ScheduledMailSummary[];
  readonly nextCursor?: string;
  readonly scopeKey: string;
}

export const useScheduledMailPage = (accountIds: readonly string[]) => {
  const api = useMemo(() => getScheduledMailApi(), []);
  const scopeKey = getScheduledMailScopeKey(accountIds);
  const createStartingResult = (): ScheduledMailPageState => {
    const snapshot = getScheduledMailSnapshot(scopeKey);
    return snapshot === undefined
      ? {
          isInitialLoading: api !== undefined,
          isLoadingMore: false,
          items: [],
          scopeKey,
        }
      : {
          ...snapshot,
          isInitialLoading: false,
          isLoadingMore: false,
        };
  };
  const [result, setResult] =
    useState<ScheduledMailPageState>(createStartingResult);
  const [scopeKeyInState, setScopeKeyInState] = useState(scopeKey);
  const loadMoreInFlightRef = useRef(false);
  const requestRevisionRef = useRef(0);
  const resultRef = useRef(result);

  if (scopeKeyInState !== scopeKey) {
    setScopeKeyInState(scopeKey);
    setResult(createStartingResult());
  }

  const isCurrentScope = result.scopeKey === scopeKey;
  const visibleItems = isCurrentScope ? result.items : [];
  const visibleNextCursor = isCurrentScope ? result.nextCursor : undefined;

  const loadFirstPage = useCallback(
    async (showLoading: boolean) => {
      if (api === undefined) {
        setResult({
          error: "Scheduled email is unavailable in this build",
          isInitialLoading: false,
          isLoadingMore: false,
          items: [],
          scopeKey,
        });
        return;
      }
      const revision = requestRevisionRef.current + 1;
      requestRevisionRef.current = revision;
      setResult((current) =>
        current.scopeKey === scopeKey
          ? {
              ...current,
              error: undefined,
              isInitialLoading: showLoading && current.items.length === 0,
            }
          : current
      );
      try {
        const reply = await api.listPage({ accountIds });
        if (requestRevisionRef.current !== revision) {
          return;
        }
        if (!reply.ok) {
          setResult((current) =>
            current.scopeKey === scopeKey
              ? {
                  ...current,
                  error: reply.error,
                  isInitialLoading: false,
                }
              : current
          );
          return;
        }
        const snapshot = {
          accountIds,
          items: reply.data.items,
          nextCursor: reply.data.nextCursor,
          scopeKey,
        };
        setScheduledMailSnapshot(snapshot);
        setResult({
          ...snapshot,
          isInitialLoading: false,
          isLoadingMore: false,
        });
      } catch {
        if (requestRevisionRef.current === revision) {
          setResult((current) =>
            current.scopeKey === scopeKey
              ? {
                  ...current,
                  error: "Could not load scheduled emails",
                  isInitialLoading: false,
                }
              : current
          );
        }
      }
    },
    [accountIds, api, scopeKey]
  );

  useEffect(() => {
    let active = true;
    const showLoading = getScheduledMailSnapshot(scopeKey) === undefined;
    queueMicrotask(() => {
      if (active) {
        void loadFirstPage(showLoading);
      }
    });
    return () => {
      active = false;
    };
  }, [loadFirstPage, scopeKey]);

  useEffect(() => {
    if (api === undefined) {
      return;
    }
    const scope = new Set(accountIds);
    return api.onChanged((change) => {
      invalidateScheduledMailSnapshotsForAccount(change.accountId);
      if (scope.has(change.accountId)) {
        void loadFirstPage(false);
      }
    });
  }, [accountIds, api, loadFirstPage]);

  useEffect(() => {
    resultRef.current = result;
  }, [result]);

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
    setResult((current) =>
      current.scopeKey === scopeKey
        ? { ...current, isLoadingMore: true }
        : current
    );
    try {
      const reply = await api.listPage({
        accountIds,
        cursor: visibleNextCursor,
      });
      if (requestRevisionRef.current !== revision) {
        return;
      }
      if (!reply.ok) {
        setResult((current) =>
          current.scopeKey === scopeKey
            ? { ...current, error: reply.error }
            : current
        );
        return;
      }
      const { current } = resultRef;
      if (current.scopeKey !== scopeKey) {
        return;
      }
      const byKey = new Map(
        current.items.map((item) => [getScheduledMailKey(item), item] as const)
      );
      for (const item of reply.data.items) {
        byKey.set(getScheduledMailKey(item), item);
      }
      const next: ScheduledMailPageState = {
        ...current,
        error: undefined,
        items: [...byKey.values()],
        nextCursor: reply.data.nextCursor,
      };
      setScheduledMailSnapshot({
        accountIds,
        items: next.items,
        nextCursor: next.nextCursor,
        scopeKey,
      });
      resultRef.current = next;
      setResult(next);
    } catch {
      if (requestRevisionRef.current === revision) {
        setResult((current) =>
          current.scopeKey === scopeKey
            ? {
                ...current,
                error: "Could not load more scheduled emails",
              }
            : current
        );
      }
    } finally {
      loadMoreInFlightRef.current = false;
      setResult((current) =>
        current.scopeKey === scopeKey
          ? { ...current, isLoadingMore: false }
          : current
      );
    }
  }, [accountIds, api, scopeKey, visibleNextCursor]);

  const removeOptimistically = (item: ScheduledMailSummary): void => {
    const key = getScheduledMailKey(item);
    const { current } = resultRef;
    if (current.scopeKey !== scopeKey) {
      return;
    }
    const next: ScheduledMailPageState = {
      ...current,
      items: current.items.filter(
        (candidate) => getScheduledMailKey(candidate) !== key
      ),
    };
    setScheduledMailSnapshot({
      accountIds,
      items: next.items,
      nextCursor: next.nextCursor,
      scopeKey,
    });
    resultRef.current = next;
    setResult(next);
  };

  return {
    api,
    error: isCurrentScope ? result.error : undefined,
    isInitialLoading: !isCurrentScope || result.isInitialLoading,
    isLoadingMore: isCurrentScope && result.isLoadingMore,
    items: visibleItems,
    loadMore,
    nextCursor: visibleNextCursor,
    reload: () => loadFirstPage(true),
    removeOptimistically,
  };
};
