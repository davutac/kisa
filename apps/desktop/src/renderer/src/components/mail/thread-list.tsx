import { useVirtualizer } from "@tanstack/react-virtual";
import { InboxIcon, ShieldAlertIcon } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import {
  getBulkDeleteSpamConfirmation,
  getBulkTrashConfirmation,
  getDeleteSpamConfirmation,
} from "@/components/mail/delete-spam-confirmation";
import MailThreadItem from "@/components/mail/thread-item";
import ThreadSelectionBar from "@/components/mail/thread-selection-bar";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { useAppCommand, useHotkeyLayer } from "@/hotkeys";
import type { ThreadSelectionDirection } from "@/mail/thread-selection";
import {
  getNextThreadSelectionIndex,
  getThreadSelectionKey,
  getVisibleThreadSelectionIndex,
} from "@/mail/thread-selection";
import { useOpenThread } from "@/mail/use-open-thread";
import type { ThreadActions } from "@/mail/use-thread-actions";
import { useThreadDragSelection } from "@/mail/use-thread-drag-selection";
import type { GmailMailbox, GmailThreadSummary } from "@/shared/ipc/mail";
import {
  useCheckedThreadIds,
  useMailboxStore,
  useSelectedThreadId,
} from "@/state/mailbox";

interface MailThreadListProps {
  actions: ThreadActions;
  emptyMessage: string;
  emptyTitle?: string;
  hasNextPage?: boolean;
  /**
   * Rendered in place of the paging row once the cache is exhausted but the
   * mail index is still running, so reaching the end of a partly-indexed
   * mailbox reads as "more is coming" rather than as the end of the mail.
   */
  indexingMessage?: string;
  isInitialLoading: boolean;
  isLoadingNextPage?: boolean;
  loadNextPage?: () => Promise<boolean>;
  mailbox?: GmailMailbox;
  reloadRevision: number;
  showAccount?: boolean;
  threads: readonly GmailThreadSummary[];
}

const RAPID_SELECTION_INTERVAL_MS = 150;

const MailThreadList = ({
  actions,
  emptyMessage,
  emptyTitle = "No email",
  hasNextPage = false,
  indexingMessage,
  isInitialLoading,
  isLoadingNextPage = false,
  loadNextPage,
  mailbox = "inbox",
  reloadRevision,
  showAccount = false,
  threads,
}: MailThreadListProps) => {
  const confirm = useConfirm();
  const scrollElementRef = useRef<HTMLElement>(null);
  const listElementRef = useRef<HTMLOListElement>(null);
  const selectedThreadKey = useSelectedThreadId();
  const checkedThreadIds = useCheckedThreadIds();
  const openThread = useOpenThread();
  const checkThread = useMailboxStore((state) => state.checkThread);
  const clearCheckedThreads = useMailboxStore(
    (state) => state.clearCheckedThreads
  );
  const retainCheckedThreads = useMailboxStore(
    (state) => state.retainCheckedThreads
  );
  const selectThread = useMailboxStore((state) => state.selectThread);
  const lastSelectionMoveAtRef = useRef<number | null>(null);
  const previousReloadRevisionRef = useRef(reloadRevision);
  const threadKeys = useMemo(
    () => threads.map((thread) => getThreadSelectionKey(thread)),
    [threads]
  );
  const dragSelection = useThreadDragSelection({
    checkThread,
    checkedThreadIds,
    scrollElementRef,
    selectThread,
    threadKeys,
  });
  // The trailing row is the paging trigger, but it also carries the indexing
  // notice — the auto-load effect below still keys off `hasNextPage` alone, so
  // showing the notice cannot start a paging loop against an exhausted cache.
  const hasTrailingRow = hasNextPage || indexingMessage !== undefined;
  const emptyIcon = mailbox === "spam" ? <ShieldAlertIcon /> : <InboxIcon />;
  const rowVirtualizer = useVirtualizer<HTMLElement, HTMLLIElement>({
    count: threads.length + (hasTrailingRow ? 1 : 0),
    estimateSize: () => 88,
    getItemKey: (index) => {
      const thread = threads[index];
      return thread === undefined
        ? "next-page-loader"
        : `${thread.accountId}:${thread.threadId}`;
    },
    getScrollElement: () => scrollElementRef.current,
    overscan: 8,
    scrollPaddingEnd: 24,
    scrollPaddingStart: 24,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const selectedThreadIndex = threads.findIndex(
    (thread) => getThreadSelectionKey(thread) === selectedThreadKey
  );
  const selectedThread = threads[selectedThreadIndex];
  const checkedThreads = useMemo(
    () =>
      threads.filter((thread) =>
        checkedThreadIds.has(getThreadSelectionKey(thread))
      ),
    [checkedThreadIds, threads]
  );
  const handleToggleRead = actions.toggleRead;
  const handleTrash = mailbox === "spam" ? undefined : actions.trash;
  const requestDeleteSpam = useCallback(
    async (thread: GmailThreadSummary): Promise<void> => {
      const confirmed = await confirm(
        getDeleteSpamConfirmation(thread.subject)
      );

      if (confirmed) {
        actions.deleteSpam(thread);
      }
    },
    [actions, confirm]
  );
  const requestBulkTrash = useCallback(async (): Promise<void> => {
    if (mailbox === "spam") {
      const confirmed = await confirm(
        getBulkDeleteSpamConfirmation(checkedThreads.length)
      );

      if (confirmed) {
        await actions.bulkDeleteSpam(checkedThreads);
      }
      return;
    }

    if (
      checkedThreads.length > 1 &&
      !(await confirm(getBulkTrashConfirmation(checkedThreads.length)))
    ) {
      return;
    }

    await actions.bulkTrash(checkedThreads);
  }, [actions, checkedThreads, confirm, mailbox]);
  const getVisibleSelectionIndex = (
    direction: ThreadSelectionDirection
  ): number | null => {
    const scrollElement = scrollElementRef.current;
    const listElement = listElementRef.current;

    if (scrollElement === null || listElement === null) {
      return null;
    }

    // Virtual row offsets are measured from the list, which sits inside the
    // scroller's padding, so the viewport has to be moved into that space.
    const viewportStart = scrollElement.scrollTop - listElement.offsetTop;

    return getVisibleThreadSelectionIndex(
      // Drop the next-page loader row; it is not selectable.
      virtualRows.filter((row) => row.index < threads.length),
      viewportStart,
      viewportStart + scrollElement.clientHeight,
      direction
    );
  };

  const moveSelection = (direction: ThreadSelectionDirection): void => {
    // With nothing selected the keys pick up from what is on screen rather than
    // teleporting to a list edge the reader has already scrolled away from.
    const nextIndex =
      (selectedThreadIndex === -1
        ? getVisibleSelectionIndex(direction)
        : null) ??
      getNextThreadSelectionIndex(threadKeys, selectedThreadKey, direction);

    if (nextIndex === null) {
      return;
    }

    const nextThread = threads[nextIndex];

    if (nextThread === undefined) {
      return;
    }

    selectThread(getThreadSelectionKey(nextThread));
    const now = performance.now();
    const lastSelectionMoveAt = lastSelectionMoveAtRef.current;
    const isRapidSelectionMove =
      lastSelectionMoveAt !== null &&
      now - lastSelectionMoveAt < RAPID_SELECTION_INTERVAL_MS;
    lastSelectionMoveAtRef.current = now;
    rowVirtualizer.scrollToIndex(nextIndex, {
      align: "center",
      behavior: isRapidSelectionMove ? "auto" : "smooth",
    });
  };

  useHotkeyLayer("mailbox", true);
  useAppCommand(
    "mailbox.nextThread",
    () => {
      moveSelection(1);
    },
    { enabled: threads.length > 0 }
  );
  useAppCommand(
    "mailbox.previousThread",
    () => {
      moveSelection(-1);
    },
    { enabled: threads.length > 0 }
  );
  useAppCommand(
    "mailbox.clearSelection",
    () => {
      clearCheckedThreads();
      selectThread(null);
    },
    { enabled: selectedThreadKey !== null || checkedThreadIds.size > 0 }
  );
  useAppCommand(
    "mailbox.toggleThreadSelection",
    () => {
      if (selectedThread !== undefined) {
        const key = getThreadSelectionKey(selectedThread);
        checkThread(key, !checkedThreadIds.has(key));
      }
    },
    { enabled: selectedThread !== undefined }
  );
  useAppCommand(
    "mailbox.openThread",
    () => {
      if (selectedThread !== undefined) {
        openThread(selectedThread);
      }
    },
    { enabled: selectedThread !== undefined && checkedThreads.length === 0 }
  );
  useAppCommand(
    "mailbox.toggleThreadRead",
    () => {
      if (checkedThreads.length > 0) {
        const markUnread = checkedThreads.every((thread) => !thread.isUnread);
        void actions.bulkSetReadState(checkedThreads, markUnread);
      } else if (selectedThread !== undefined) {
        actions.toggleRead(selectedThread);
      }
    },
    {
      enabled: selectedThread !== undefined || checkedThreads.length > 0,
    }
  );
  useAppCommand(
    "mailbox.trashThread",
    () => {
      if (checkedThreads.length > 0) {
        void requestBulkTrash();
      } else if (selectedThread !== undefined) {
        if (mailbox === "spam") {
          void requestDeleteSpam(selectedThread);
        } else {
          actions.trash(selectedThread);
        }
      }
    },
    {
      enabled: selectedThread !== undefined || checkedThreads.length > 0,
    }
  );

  useEffect(() => {
    retainCheckedThreads(new Set(threadKeys));
  }, [retainCheckedThreads, threadKeys]);

  useEffect(() => {
    if (previousReloadRevisionRef.current === reloadRevision) {
      return;
    }

    previousReloadRevisionRef.current = reloadRevision;
    scrollElementRef.current?.scrollTo({ top: 0 });
  }, [reloadRevision]);

  useEffect(() => {
    const lastRow = virtualRows.at(-1);

    if (
      lastRow !== undefined &&
      lastRow.index >= threads.length - 1 &&
      hasNextPage &&
      !isLoadingNextPage &&
      loadNextPage !== undefined
    ) {
      void loadNextPage();
    }
  }, [
    hasNextPage,
    isLoadingNextPage,
    loadNextPage,
    threads.length,
    virtualRows,
  ]);

  return (
    <>
      <section
        aria-label={mailbox === "spam" ? "Spam" : "Inbox"}
        className="scroll-fade-y relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4"
        ref={scrollElementRef}
        tabIndex={-1}
      >
        {threads.length === 0 ? (
          <Empty
            aria-live="polite"
            className="absolute inset-4 w-auto border-0"
          >
            <EmptyHeader>
              <EmptyMedia variant="icon">
                {isInitialLoading ? <Spinner /> : emptyIcon}
              </EmptyMedia>
              <EmptyTitle>
                {isInitialLoading ? "Checking the post…" : emptyTitle}
              </EmptyTitle>
              {isInitialLoading ? null : (
                <EmptyDescription>{emptyMessage}</EmptyDescription>
              )}
            </EmptyHeader>
          </Empty>
        ) : null}
        <ol
          className="relative"
          ref={listElementRef}
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        >
          <AnimatePresence initial={false}>
            {virtualRows.map((virtualRow) => {
              const thread = threads[virtualRow.index];

              return thread === undefined ? (
                <li
                  className="absolute top-0 left-0 w-full py-4"
                  data-index={virtualRow.index}
                  key={virtualRow.key}
                  ref={rowVirtualizer.measureElement}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <p
                    aria-live="polite"
                    className="text-muted-foreground text-center text-sm"
                  >
                    {hasNextPage
                      ? "Fetching the next chapter…"
                      : indexingMessage}
                  </p>
                </li>
              ) : (
                <MailThreadItem
                  data-index={virtualRow.index}
                  data-thread-selection-key={getThreadSelectionKey(thread)}
                  hasCheckedThreads={checkedThreadIds.size > 0}
                  isChecked={checkedThreadIds.has(
                    getThreadSelectionKey(thread)
                  )}
                  isSelected={
                    getThreadSelectionKey(thread) === selectedThreadKey
                  }
                  key={virtualRow.key}
                  onDeleteSpam={
                    mailbox === "spam"
                      ? (target) => {
                          void requestDeleteSpam(target);
                        }
                      : undefined
                  }
                  onOpen={(target, event) => {
                    if (dragSelection.consumeSuppressedOpen(event.detail)) {
                      return;
                    }

                    if (checkedThreadIds.size === 0) {
                      openThread(target);
                      return;
                    }

                    const key = getThreadSelectionKey(target);
                    checkThread(key, !checkedThreadIds.has(key));
                    selectThread(key);
                  }}
                  onRowPointerDown={(target, event) => {
                    dragSelection.onRowPointerDown(
                      getThreadSelectionKey(target),
                      event
                    );
                  }}
                  onNotSpam={mailbox === "spam" ? actions.notSpam : undefined}
                  onSelectionPointerDown={(target, event) => {
                    dragSelection.onSelectionPointerDown(
                      getThreadSelectionKey(target),
                      event
                    );
                  }}
                  onSelectionPointerEnter={(target) => {
                    dragSelection.onSelectionPointerEnter(
                      getThreadSelectionKey(target)
                    );
                  }}
                  onToggleRead={handleToggleRead}
                  onToggleSelection={(target) => {
                    const key = getThreadSelectionKey(target);
                    checkThread(key, !checkedThreadIds.has(key));
                    selectThread(key);
                  }}
                  onTrash={handleTrash}
                  position={virtualRow.index + 1}
                  ref={rowVirtualizer.measureElement}
                  setSize={threads.length}
                  showAccount={showAccount}
                  style={{ top: virtualRow.start }}
                  thread={thread}
                />
              );
            })}
          </AnimatePresence>
        </ol>
      </section>
      <AnimatePresence initial={false}>
        {checkedThreads.length === 0 ? null : (
          <ThreadSelectionBar
            actions={actions}
            key="thread-selection-bar"
            mailbox={mailbox}
            onClear={clearCheckedThreads}
            onTrash={requestBulkTrash}
            threads={checkedThreads}
          />
        )}
      </AnimatePresence>
    </>
  );
};

export default MailThreadList;
