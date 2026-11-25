import { createController } from "@ui-sdk/core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { useInstanceValue } from "@/hooks/use-instance-value";
import { useAppCommand, useHotkeyLayer } from "@/hotkeys";
import { runWithCleanup } from "@/lib/run-with-cleanup";
import { useMailboxAccountScope } from "@/mail/use-mailbox-account-scope";
import type { MailListController } from "@/primitives/mail-list";
import {
  getScheduledMailKey,
  orderScheduledMailItems,
  shouldCloseScheduledMailEditor,
} from "@/scheduled/scheduled-mail-view";
import { useScheduledMailNavigation } from "@/scheduled/scheduled-navigation";
import { useScheduledMailPage } from "@/scheduled/use-scheduled-mail-page";
import type {
  ScheduledMailEditSession,
  ScheduledMailSummary,
} from "@/shared/ipc/scheduled-mail";
import { useAccounts } from "@/state/accounts";

export const useScheduledMailWorkspace = () => {
  const confirm = useConfirm();
  const accounts = useAccounts();
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
  const itemsByKey = useMemo(
    () => new Map(items.map((item) => [getScheduledMailKey(item), item])),
    [items]
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedItem =
    selectedKey === null ? null : (itemsByKey.get(selectedKey) ?? null);
  const [quickActionResetRevision, setQuickActionResetRevision] = useState(0);
  const [editSession, setEditSession] =
    useState<ScheduledMailEditSession | null>(null);
  const [lastRenderedIndex, setLastRenderedIndex] = useState<number>();
  const pendingNavigation = useScheduledMailNavigation((state) => state.target);
  const clearPendingNavigation = useScheduledMailNavigation(
    (state) => state.clear
  );
  const list = useInstanceValue(() => createController<MailListController>());
  const openingKeyRef = useRef<string | null>(null);
  const previousEditSessionRef = useRef(editSession);

  // However the editor closes, focus returns to the row it was opened from,
  // once the list behind it can take focus again.
  useLayoutEffect(() => {
    const wasEditing = previousEditSessionRef.current !== null;
    previousEditSessionRef.current = editSession;
    if (wasEditing && editSession === null) {
      list.focusCurrent();
    }
  }, [editSession, list]);

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
      openingKeyRef.current = key;
      await runWithCleanup(
        async () => {
          try {
            const reply = await api.beginEdit({
              accountId: item.accountId,
              draftId: item.draftId,
            });
            if (!reply.ok) {
              toast.error(reply.error);
              return;
            }
            setSelectedKey(key);
            setEditSession(reply.data);
          } catch {
            toast.error("Could not open scheduled email");
          }
        },
        () => {
          openingKeyRef.current = null;
        }
      );
    },
    [api]
  );

  const cancelSchedule = async (item: ScheduledMailSummary): Promise<void> => {
    if (api === undefined) {
      return;
    }
    try {
      const reply = await api.cancelToStash({
        accountId: item.accountId,
        draftId: item.draftId,
      });
      if (!reply.ok) {
        toast.error(reply.error);
        return;
      }
      // The list moves the active row, and focus, to the one taking its place.
      removeOptimistically(item);
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
      toast.success("Scheduled email discarded.");
    } catch {
      toast.error("Could not discard scheduled email");
    }
  };

  useHotkeyLayer("scheduled", true);
  useAppCommand("scheduled.clearActiveRow", () => {
    setQuickActionResetRevision((revision) => revision + 1);
    list.clear();
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
  useAppCommand("scheduled.next", () => list.move(1), {
    enabled: items.length > 0,
  });
  useAppCommand("scheduled.previous", () => list.move(-1), {
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
        setEditSession(null);
      }
    });
  }, [api, editSession]);

  useEffect(() => {
    if (
      lastRenderedIndex !== undefined &&
      lastRenderedIndex >= items.length - 1 &&
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
    lastRenderedIndex,
    loadMore,
    nextCursor,
  ]);

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
    activate: (key: string): void => {
      const item = itemsByKey.get(key);
      if (item !== undefined) {
        void openEditor(item);
      }
    },
    cancelSchedule,
    closeEditor: () => {
      setEditSession(null);
    },
    editSession,
    error,
    discardScheduledEmail,
    isInitialLoading,
    itemKeys,
    items,
    itemsByKey,
    labelOf: (key: string): string =>
      itemsByKey.get(key)?.subject.trim() || "No subject",
    list,
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
    rowCount: nextCursor === undefined ? items.length : -1,
    selectedAccountId,
    selectedKey,
    setLastRenderedIndex,
    setSelectedKey,
  };
};
