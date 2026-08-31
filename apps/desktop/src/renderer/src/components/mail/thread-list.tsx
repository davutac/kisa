import { useVirtualizer } from "@tanstack/react-virtual";
import {
  InboxIcon,
  SearchIcon,
  SendIcon,
  ShieldAlertIcon,
  Trash2Icon,
} from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import {
  getBulkDeleteForeverConfirmation,
  getDeleteForeverConfirmation,
} from "@/components/mail/delete-forever-confirmation";
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
import {
  getBulkThreadDestructiveAction,
  getThreadDestructiveAction,
} from "@/mail/thread-destructive-action";
import type { ThreadSelectionDirection } from "@/mail/thread-selection";
import {
  getNextThreadSelectionIndex,
  getThreadSelectionKey,
  getThreadSelectionScrollBehavior,
  getVisibleThreadSelectionIndex,
} from "@/mail/thread-selection";
import { blurFocusedMailboxLabel } from "@/mail/use-mailbox-label-navigation";
import { useOpenThread } from "@/mail/use-open-thread";
import type { ThreadActions } from "@/mail/use-thread-actions";
import { useThreadDragSelection } from "@/mail/use-thread-drag-selection";
import type { GmailMailbox, GmailThreadSummary } from "@/shared/ipc/mail";
import {
  useCheckedThreadIds,
  useMailboxStore,
  useSelectedThreadId,
} from "@/state/mailbox";

export interface MailThreadListProps {
  actions: ThreadActions;
  emptyMessage: string;
  emptyTitle?: string;
  hasNextPage?: boolean;
  /** A passive final row, such as indexing progress or a capped-search note. */
  trailingMessage?: string;
  isInitialLoading: boolean;
  isLoadingNextPage?: boolean;
  loadingTitle?: string;
  loadNextPage?: () => Promise<boolean>;
  mailbox?: GmailMailbox;
  scrollResetKey: number | string;
  searchResults?: boolean;
  showAccount?: boolean;
  threads: readonly GmailThreadSummary[];
}

const getRowDestructiveActions = (
  thread: GmailThreadSummary,
  onDeleteForever: (thread: GmailThreadSummary) => void,
  onTrash: ThreadActions["trash"]
) =>
  getThreadDestructiveAction(thread.labels) === "deleteForever"
    ? { onDeleteForever, onTrash: undefined }
    : { onDeleteForever: undefined, onTrash };

const hasDestructiveTarget = (
  checkedCount: number,
  bulkAction: ReturnType<typeof getBulkThreadDestructiveAction>,
  selectedThread: GmailThreadSummary | undefined
): boolean =>
  checkedCount === 0 ? selectedThread !== undefined : bulkAction !== undefined;

interface ThreadListPresentation {
  readonly emptyIcon: React.ReactNode;
  readonly label: string;
}

const getThreadListPresentation = (
  searchResults: boolean,
  mailbox: GmailMailbox
): ThreadListPresentation => {
  if (searchResults) {
    return { emptyIcon: <SearchIcon />, label: "Search results" };
  }
  if (mailbox === "spam") {
    return { emptyIcon: <ShieldAlertIcon />, label: "Spam" };
  }
  if (mailbox === "sent") {
    return { emptyIcon: <SendIcon />, label: "Sent" };
  }
  if (mailbox === "trash") {
    return { emptyIcon: <Trash2Icon />, label: "Trash" };
  }
  return { emptyIcon: <InboxIcon />, label: "Inbox" };
};

const MailThreadList = ({
  actions,
  emptyMessage,
  emptyTitle = "No email",
  hasNextPage = false,
  trailingMessage,
  isInitialLoading,
  isLoadingNextPage = false,
  loadingTitle = "Checking the post…",
  loadNextPage,
  mailbox = "inbox",
  scrollResetKey,
  searchResults = false,
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
  const previousScrollResetKeyRef = useRef(scrollResetKey);
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
  // The trailing row can be a paging trigger or a passive note. Auto-load still
  // keys off `hasNextPage`, so a note cannot start a paging loop.
  const hasTrailingRow = hasNextPage || trailingMessage !== undefined;
  const presentation = getThreadListPresentation(searchResults, mailbox);
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
  const bulkDestructiveAction = getBulkThreadDestructiveAction(checkedThreads);
  const handleToggleRead = actions.toggleRead;
  const requestDeleteForever = useCallback(
    async (thread: GmailThreadSummary): Promise<void> => {
      const confirmed = await confirm(
        getDeleteForeverConfirmation(thread.subject)
      );

      if (confirmed) {
        actions.deleteForever(thread);
      }
    },
    [actions, confirm]
  );
  const handleDeleteForever = useCallback(
    (thread: GmailThreadSummary): void => {
      void requestDeleteForever(thread);
    },
    [requestDeleteForever]
  );
  const requestBulkDeleteForever = useCallback(async (): Promise<void> => {
    const confirmed = await confirm(
      getBulkDeleteForeverConfirmation(checkedThreads.length)
    );

    if (confirmed) {
      await actions.bulkDeleteForever(checkedThreads);
    }
  }, [actions, checkedThreads, confirm]);
  const requestBulkTrash = useCallback(async (): Promise<void> => {
    await actions.bulkTrash(checkedThreads);
  }, [actions, checkedThreads]);
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
    const scrollBehavior = getThreadSelectionScrollBehavior(
      lastSelectionMoveAtRef.current,
      now
    );
    lastSelectionMoveAtRef.current = now;
    rowVirtualizer.scrollToIndex(nextIndex, {
      align: "center",
      behavior: scrollBehavior,
    });
  };

  const handoffSearchSelection = (
    direction: ThreadSelectionDirection
  ): void => {
    moveSelection(direction);
    if (document.activeElement instanceof HTMLInputElement) {
      document.activeElement.blur();
    }
  };

  useHotkeyLayer("mailbox", true);
  useAppCommand(
    "search.nextThread",
    () => {
      handoffSearchSelection(1);
    },
    { enabled: threads.length > 0 }
  );
  useAppCommand(
    "search.previousThread",
    () => {
      handoffSearchSelection(-1);
    },
    { enabled: threads.length > 0 }
  );
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
  useAppCommand("mailbox.clearSelection", () => {
    clearCheckedThreads();
    selectThread(null);
    blurFocusedMailboxLabel();
  });
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
    { enabled: selectedThread !== undefined || checkedThreads.length > 0 }
  );
  useAppCommand(
    "mailbox.trashThread",
    () => {
      if (checkedThreads.length > 0) {
        if (bulkDestructiveAction === "deleteForever") {
          void requestBulkDeleteForever();
        } else if (bulkDestructiveAction === "trash") {
          void requestBulkTrash();
        }
      } else if (selectedThread !== undefined) {
        if (
          getThreadDestructiveAction(selectedThread.labels) === "deleteForever"
        ) {
          void requestDeleteForever(selectedThread);
        } else {
          actions.trash(selectedThread);
        }
      }
    },
    {
      enabled: hasDestructiveTarget(
        checkedThreads.length,
        bulkDestructiveAction,
        selectedThread
      ),
    }
  );

  useEffect(() => {
    retainCheckedThreads(new Set(threadKeys));
  }, [retainCheckedThreads, threadKeys]);

  useEffect(() => {
    if (previousScrollResetKeyRef.current === scrollResetKey) {
      return;
    }

    previousScrollResetKeyRef.current = scrollResetKey;
    scrollElementRef.current?.scrollTo({ top: 0 });
  }, [scrollResetKey]);

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
        aria-label={presentation.label}
        className="scroll-fade-y relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-4"
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
                {isInitialLoading ? <Spinner /> : presentation.emptyIcon}
              </EmptyMedia>
              <EmptyTitle>
                {isInitialLoading ? loadingTitle : emptyTitle}
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
                      : trailingMessage}
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
                  {...getRowDestructiveActions(
                    thread,
                    handleDeleteForever,
                    actions.trash
                  )}
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
            onClear={clearCheckedThreads}
            onDeleteForever={
              bulkDestructiveAction === "deleteForever"
                ? requestBulkDeleteForever
                : undefined
            }
            onTrash={
              bulkDestructiveAction === "trash" ? requestBulkTrash : undefined
            }
            threads={checkedThreads}
          />
        )}
      </AnimatePresence>
    </>
  );
};

export default MailThreadList;
