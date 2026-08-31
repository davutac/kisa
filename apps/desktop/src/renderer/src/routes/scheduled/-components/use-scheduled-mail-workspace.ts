import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { useAppCommand, useHotkeyLayer } from "@/hotkeys";
import type { ThreadSelectionDirection } from "@/mail/thread-selection";
import {
  getThreadSelectionScrollBehavior,
  getVisibleThreadSelectionIndex,
} from "@/mail/thread-selection";
import { useMailboxAccountScope } from "@/mail/use-mailbox-account-scope";
import {
  getScheduledMailKey,
  orderScheduledMailItems,
  shouldCloseScheduledMailEditor,
} from "@/scheduled/scheduled-mail-view";
import {
  focusScheduledMailTarget,
  getScheduledMailSelectionIndex,
  useScheduledMailNavigation,
} from "@/scheduled/scheduled-navigation";
import { useScheduledMailPage } from "@/scheduled/use-scheduled-mail-page";
import type {
  ScheduledMailEditSession,
  ScheduledMailSummary,
} from "@/shared/ipc/scheduled-mail";
import { useGoogleAccounts } from "@/state/google-accounts";

export const useScheduledMailWorkspace = () => {
  const confirm = useConfirm();
  const accounts = useGoogleAccounts();
  const { accountIds, selectedAccountId } = useMailboxAccountScope();
  const {
    api,
    error,
    isInitialLoading,
    isLoadingMore,
    items: pageItems,
    loadMore,
    nextCursor,
    reload,
    removeOptimistically,
  } = useScheduledMailPage(accountIds);
  const items = useMemo(() => orderScheduledMailItems(pageItems), [pageItems]);
  const itemKeys = useMemo(() => items.map(getScheduledMailKey), [items]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedItem = useMemo(
    () =>
      items.find((item) => getScheduledMailKey(item) === selectedKey) ?? null,
    [items, selectedKey]
  );
  const [quickActionResetRevision, setQuickActionResetRevision] = useState(0);
  const [focusRevision, setFocusRevision] = useState(0);
  const [editSession, setEditSession] =
    useState<ScheduledMailEditSession | null>(null);
  const pendingNavigation = useScheduledMailNavigation((state) => state.target);
  const clearPendingNavigation = useScheduledMailNavigation(
    (state) => state.clear
  );
  const scrollRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const lastSelectionMoveAtRef = useRef<number | null>(null);
  const openingKeyRef = useRef<string | null>(null);
  const pendingFocusKeyRef = useRef<string | null | false>(false);
  const editOriginKeyRef = useRef<string | null>(null);
  const virtualizer = useVirtualizer<HTMLElement, HTMLLIElement>({
    count:
      items.length + (nextCursor === undefined || error !== undefined ? 0 : 1),
    estimateSize: () => 105,
    getItemKey: (index) => {
      const item = items[index];
      return item === undefined
        ? "scheduled-mail-next-page"
        : getScheduledMailKey(item);
    },
    getScrollElement: () => scrollRef.current,
    overscan: 8,
    scrollPaddingEnd: 24,
    scrollPaddingStart: 24,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const lastVirtualIndex = virtualItems.at(-1)?.index;

  const focusAfterMutation = (key: string | null): void => {
    pendingFocusKeyRef.current = key;
    setFocusRevision((revision) => revision + 1);
  };

  useLayoutEffect(() => {
    const pending = pendingFocusKeyRef.current;
    if (pending === false) {
      return;
    }
    pendingFocusKeyRef.current = false;
    focusScheduledMailTarget(pending, rowRefs.current, headingRef.current);
  }, [focusRevision, items]);

  const getVisibleSelectionIndex = (
    direction: ThreadSelectionDirection
  ): number | null => {
    const scrollElement = scrollRef.current;
    const listElement = listRef.current;

    if (scrollElement === null || listElement === null) {
      return null;
    }

    const viewportStart = scrollElement.scrollTop - listElement.offsetTop;

    return getVisibleThreadSelectionIndex(
      virtualItems.filter((row) => row.index < items.length),
      viewportStart,
      viewportStart + scrollElement.clientHeight,
      direction
    );
  };

  const moveSelection = (direction: ThreadSelectionDirection): void => {
    const index = getScheduledMailSelectionIndex(
      itemKeys,
      selectedKey,
      getVisibleSelectionIndex(direction),
      direction
    );
    if (index === null) {
      return;
    }
    const item = items[index];
    if (item === undefined) {
      return;
    }
    const key = getScheduledMailKey(item);
    setSelectedKey(key);
    const now = performance.now();
    const scrollBehavior = getThreadSelectionScrollBehavior(
      lastSelectionMoveAtRef.current,
      now
    );
    lastSelectionMoveAtRef.current = now;
    virtualizer.scrollToIndex(index, {
      align: "center",
      behavior: scrollBehavior,
    });
    focusAfterMutation(key);
  };

  const openEditor = useCallback(
    async (item: ScheduledMailSummary): Promise<void> => {
      if (
        api === undefined ||
        item.deliveryState === "sending" ||
        openingKeyRef.current !== null
      ) {
        return;
      }
      const key = getScheduledMailKey(item);
      setSelectedKey(key);
      openingKeyRef.current = key;
      try {
        const reply = await api.beginEdit({
          accountId: item.accountId,
          draftId: item.draftId,
        });
        if (!reply.ok) {
          toast.error(reply.error);
          return;
        }
        editOriginKeyRef.current = key;
        setEditSession(reply.data);
      } catch {
        toast.error("Could not open scheduled email");
      } finally {
        openingKeyRef.current = null;
      }
    },
    [api]
  );

  const cancelSchedule = async (item: ScheduledMailSummary): Promise<void> => {
    if (api === undefined) {
      return;
    }
    const index = items.findIndex(
      (candidate) =>
        getScheduledMailKey(candidate) === getScheduledMailKey(item)
    );
    const nextItem = items[index + 1] ?? items[index - 1];
    try {
      const reply = await api.cancelToStash({
        accountId: item.accountId,
        draftId: item.draftId,
      });
      if (!reply.ok) {
        toast.error(reply.error);
        return;
      }
      removeOptimistically(item);
      const nextKey =
        nextItem === undefined ? null : getScheduledMailKey(nextItem);
      setSelectedKey(nextKey);
      focusAfterMutation(nextKey);
      toast.success("Schedule canceled. Draft moved to Stash.");
    } catch {
      toast.error("Could not cancel scheduled email");
    }
  };

  const discardScheduledEmail = async (
    item: ScheduledMailSummary
  ): Promise<void> => {
    if (api === undefined) {
      return;
    }
    const confirmed = await confirm({
      cancelLabel: "Keep scheduled",
      confirmLabel: "Discard email",
      confirmVariant: "destructive",
      description:
        "This permanently deletes the scheduled email and its draft. This cannot be undone.",
      title: "Discard scheduled email?",
    });
    if (!confirmed) {
      return;
    }
    const index = items.findIndex(
      (candidate) =>
        getScheduledMailKey(candidate) === getScheduledMailKey(item)
    );
    const nextItem = items[index + 1] ?? items[index - 1];
    try {
      const reply = await api.discard({
        accountId: item.accountId,
        draftId: item.draftId,
      });
      if (!reply.ok) {
        toast.error(reply.error);
        return;
      }
      removeOptimistically(item);
      const nextKey =
        nextItem === undefined ? null : getScheduledMailKey(nextItem);
      setSelectedKey(nextKey);
      focusAfterMutation(nextKey);
      toast.success("Scheduled email discarded.");
    } catch {
      toast.error("Could not discard scheduled email");
    }
  };

  useHotkeyLayer("scheduled", true);
  useAppCommand("scheduled.clearActiveRow", () => {
    setSelectedKey(null);
    setQuickActionResetRevision((revision) => revision + 1);
    focusAfterMutation(null);
  });
  useAppCommand(
    "scheduled.cancel",
    () => {
      if (selectedItem !== null) {
        void cancelSchedule(selectedItem);
      }
    },
    {
      enabled:
        selectedItem !== null && selectedItem.deliveryState !== "sending",
    }
  );
  useAppCommand(
    "scheduled.discard",
    () => {
      if (selectedItem !== null) {
        void discardScheduledEmail(selectedItem);
      }
    },
    {
      enabled:
        selectedItem !== null && selectedItem.deliveryState !== "sending",
    }
  );
  useAppCommand("scheduled.next", () => moveSelection(1), {
    enabled: items.length > 0,
  });
  useAppCommand("scheduled.previous", () => moveSelection(-1), {
    enabled: items.length > 0,
  });
  useAppCommand(
    "scheduled.open",
    () => {
      if (selectedItem !== null) {
        void openEditor(selectedItem);
      }
    },
    { enabled: selectedKey !== null && editSession === null }
  );

  useEffect(() => {
    if (api === undefined || editSession === null) {
      return;
    }
    return api.onChanged((change) => {
      if (shouldCloseScheduledMailEditor(change, editSession)) {
        pendingFocusKeyRef.current = null;
        setEditSession(null);
        setFocusRevision((revision) => revision + 1);
      }
    });
  }, [api, editSession]);

  useEffect(() => {
    if (
      lastVirtualIndex !== undefined &&
      lastVirtualIndex >= items.length - 1 &&
      nextCursor !== undefined &&
      !isLoadingMore &&
      error === undefined
    ) {
      void loadMore();
    }
  }, [
    error,
    isLoadingMore,
    items.length,
    lastVirtualIndex,
    loadMore,
    nextCursor,
  ]);

  useEffect(() => {
    if (
      selectedKey !== null &&
      !items.some((item) => getScheduledMailKey(item) === selectedKey)
    ) {
      setSelectedKey(null);
    }
  }, [items, selectedKey]);

  useEffect(() => {
    if (pendingNavigation === null || isInitialLoading || error !== undefined) {
      return;
    }
    const target = items.find(
      (item) =>
        item.accountId === pendingNavigation.accountId &&
        item.draftId === pendingNavigation.draftId
    );
    if (target !== undefined) {
      clearPendingNavigation();
      void openEditor(target);
      return;
    }
    if (nextCursor !== undefined && !isLoadingMore) {
      void loadMore();
      return;
    }
    if (nextCursor === undefined) {
      clearPendingNavigation();
      toast.error("That scheduled email is no longer available");
    }
  }, [
    clearPendingNavigation,
    error,
    isInitialLoading,
    isLoadingMore,
    items,
    loadMore,
    nextCursor,
    openEditor,
    pendingNavigation,
  ]);

  return {
    accounts,
    cancelSchedule,
    closeEditor: () => {
      const origin = editOriginKeyRef.current;
      setEditSession(null);
      focusAfterMutation(origin);
    },
    editSession,
    error,
    discardScheduledEmail,
    headingRef,
    isInitialLoading,
    items,
    listRef,
    measureElement: virtualizer.measureElement,
    openEditor,
    quickActionResetRevision,
    reload,
    replaceEditSession: (session: ScheduledMailEditSession) => {
      setEditSession((current) =>
        current?.item.accountId === session.item.accountId &&
        current.item.draftId === session.item.draftId
          ? session
          : current
      );
    },
    scrollRef,
    selectedAccountId,
    selectedKey,
    setSize: nextCursor === undefined ? items.length : -1,
    setRowRef: (key: string, element: HTMLButtonElement | null) => {
      if (element === null) {
        rowRefs.current.delete(key);
      } else {
        rowRefs.current.set(key, element);
      }
    },
    totalSize: virtualizer.getTotalSize(),
    virtualItems,
  };
};
