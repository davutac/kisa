import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CircleAlertIcon,
  InboxIcon,
  SearchIcon,
  SendIcon,
  ShieldAlertIcon,
  TagIcon,
  Trash2Icon,
} from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { MouseEvent, PointerEvent } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import {
  getBulkDeleteForeverConfirmation,
  getDeleteForeverConfirmation,
} from "@/components/mail/delete-forever-confirmation";
import MailThreadItem from "@/components/mail/thread-item";
import ThreadSelectionBar from "@/components/mail/thread-selection-bar";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { useRemeasureOnScrollSettle } from "@/hooks/use-remeasure-on-scroll-settle";
import { useAppCommand, useHotkeyLayer } from "@/hotkeys";
import { getMailboxSystemLabel } from "@/mail/label";
import { isLabelPlace } from "@/mail/mailbox-place";
import type { MailboxPlace } from "@/mail/mailbox-place";
import {
  getThreadListPlaceholder,
  shouldLoadNextPage,
} from "@/mail/mailbox-threads-load";
import type { ThreadListPlaceholder } from "@/mail/mailbox-threads-load";
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
import { useOpenThread } from "@/mail/use-open-thread";
import type { ThreadActions } from "@/mail/use-thread-actions";
import { useThreadDragSelection } from "@/mail/use-thread-drag-selection";
import type { MailThreadSummary } from "@/shared/ipc/mail";
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
  /** Why the last load of this list failed, while it has not been retried. */
  loadError?: string;
  /** The heading for a failed load with nothing to show. */
  loadErrorTitle?: string;
  loadingTitle?: string;
  loadNextPage?: () => Promise<boolean>;
  mailbox?: MailboxPlace;
  onRetryLoad?: () => void;
  scrollResetKey: number | string;
  searchResults?: boolean;
  showAccount?: boolean;
  threads: readonly MailThreadSummary[];
}

const getRowDestructiveActions = (
  thread: MailThreadSummary,
  onDeleteForever: (thread: MailThreadSummary) => void,
  onTrash: ThreadActions["trash"]
) =>
  getThreadDestructiveAction(thread.labels) === "deleteForever"
    ? { onDeleteForever, onTrash: undefined }
    : { onDeleteForever: undefined, onTrash };

const hasDestructiveTarget = (
  checkedCount: number,
  bulkAction: ReturnType<typeof getBulkThreadDestructiveAction>,
  selectedThread: MailThreadSummary | undefined
): boolean =>
  checkedCount === 0 ? selectedThread !== undefined : bulkAction !== undefined;

interface ThreadListPresentation {
  readonly emptyIcon: React.ReactNode;
  readonly label: string;
  /**
   * The mailbox's own label, left off its rows. Search spans every mailbox,
   * so its rows keep the label that says where each one lives.
   */
  readonly mailboxLabel?: string;
}

const getThreadListPresentation = (
  searchResults: boolean,
  mailbox: MailboxPlace
): ThreadListPresentation => {
  if (searchResults) {
    return { emptyIcon: <SearchIcon />, label: "Search results" };
  }
  if (isLabelPlace(mailbox)) {
    return {
      emptyIcon: <TagIcon />,
      label: mailbox.label,
      mailboxLabel: mailbox.label,
    };
  }
  const mailboxLabel = getMailboxSystemLabel(mailbox);
  if (mailbox === "spam") {
    return { emptyIcon: <ShieldAlertIcon />, label: "Spam", mailboxLabel };
  }
  if (mailbox === "sent") {
    return { emptyIcon: <SendIcon />, label: "Sent", mailboxLabel };
  }
  if (mailbox === "trash") {
    return { emptyIcon: <Trash2Icon />, label: "Trash", mailboxLabel };
  }
  return { emptyIcon: <InboxIcon />, label: "Inbox", mailboxLabel };
};

interface ThreadListPlaceholderView {
  readonly description?: string;
  readonly icon: React.ReactNode;
  readonly title: string;
}

interface ThreadListPlaceholderCopy {
  readonly emptyIcon: React.ReactNode;
  readonly emptyMessage: string;
  readonly emptyTitle: string;
  readonly loadError: string | undefined;
  readonly loadErrorTitle: string;
  readonly loadingTitle: string;
}

const getThreadListPlaceholderView = (
  placeholder: ThreadListPlaceholder,
  copy: ThreadListPlaceholderCopy
): ThreadListPlaceholderView => {
  if (placeholder === "loading") {
    return { icon: <Spinner />, title: copy.loadingTitle };
  }
  if (placeholder === "failed") {
    return {
      description: copy.loadError,
      icon: <CircleAlertIcon />,
      title: copy.loadErrorTitle,
    };
  }
  return {
    description: copy.emptyMessage,
    icon: copy.emptyIcon,
    title: copy.emptyTitle,
  };
};

const RetryLoadButton = ({ onRetry }: { readonly onRetry?: () => void }) =>
  onRetry === undefined ? null : (
    <Button onClick={onRetry} size="xs" type="button" variant="secondary">
      Try again
    </Button>
  );

/** What the list shows in place of rows: loading, empty, or a failed load. */
const ThreadListPlaceholderPane = ({
  copy,
  isInitialLoading,
  onRetryLoad,
  threadCount,
}: {
  readonly copy: ThreadListPlaceholderCopy;
  readonly isInitialLoading: boolean;
  readonly onRetryLoad: (() => void) | undefined;
  readonly threadCount: number;
}) => {
  const placeholder = getThreadListPlaceholder({
    hasLoadError: copy.loadError !== undefined,
    isInitialLoading,
    threadCount,
  });
  if (placeholder === undefined) {
    return null;
  }
  const view = getThreadListPlaceholderView(placeholder, copy);

  return (
    <Empty aria-live="polite" className="absolute inset-4 w-auto border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">{view.icon}</EmptyMedia>
        <EmptyTitle>{view.title}</EmptyTitle>
        {view.description === undefined ? null : (
          <EmptyDescription>{view.description}</EmptyDescription>
        )}
      </EmptyHeader>
      {placeholder === "failed" ? (
        <EmptyContent>
          <RetryLoadButton onRetry={onRetryLoad} />
        </EmptyContent>
      ) : null}
    </Empty>
  );
};

/** The row after the last conversation: a failed load, paging, or a note. */
const ThreadListTrailingNote = ({
  hasNextPage,
  loadError,
  onRetryLoad,
  trailingMessage,
}: {
  readonly hasNextPage: boolean;
  readonly loadError: string | undefined;
  readonly onRetryLoad: (() => void) | undefined;
  readonly trailingMessage: string | undefined;
}) =>
  loadError === undefined ? (
    <p aria-live="polite" className="text-muted-foreground text-center text-sm">
      {hasNextPage ? "Fetching the next chapter…" : trailingMessage}
    </p>
  ) : (
    <div className="flex items-center justify-center gap-2">
      <output className="text-destructive text-sm">{loadError}</output>
      <RetryLoadButton onRetry={onRetryLoad} />
    </div>
  );

const MailThreadList = ({
  actions,
  emptyMessage,
  emptyTitle = "No email",
  hasNextPage = false,
  trailingMessage,
  isInitialLoading,
  isLoadingNextPage = false,
  loadError,
  loadErrorTitle = "Could not load this mailbox",
  loadingTitle = "Checking the post…",
  loadNextPage,
  mailbox = "inbox",
  onRetryLoad,
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
  // A failure with rows on screen is reported after them; without rows the
  // placeholder reports it.
  const trailingError = threads.length > 0 ? loadError : undefined;
  const hasTrailingRow =
    hasNextPage || trailingMessage !== undefined || trailingError !== undefined;
  const presentation = getThreadListPresentation(searchResults, mailbox);
  // The floating selection bar (bottom-4 plus its 44px height) would cover
  // the last row, so the list reserves room below it while it is shown.
  const bottomClearance = checkedThreadIds.size > 0 ? 80 : 16;
  const remeasureOnScrollSettle = useRemeasureOnScrollSettle();
  // oxlint-disable-next-line react/incompatible-library -- TanStack Virtual returns a mutable instance, so React Compiler leaves this component uncompiled; only per-render values and the stable `measureElement` leave it.
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
    onChange: remeasureOnScrollSettle,
    overscan: 8,
    scrollPaddingEnd: bottomClearance + 8,
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
  // This component calls `useVirtualizer`, so React Compiler skips it and every
  // scroll range change re-renders it. Row props stay referentially stable so
  // memoized rows skip that render; checked state is read at event time rather
  // than captured, so toggling one row does not re-render the others.
  const {
    consumeSuppressedOpen,
    onRowPointerDown,
    onSelectionPointerDown,
    onSelectionPointerEnter,
  } = dragSelection;
  const handleOpen = useCallback(
    (target: MailThreadSummary, event: MouseEvent): void => {
      if (consumeSuppressedOpen(event.detail)) {
        return;
      }

      const { checkedThreadIds: currentCheckedThreadIds } =
        useMailboxStore.getState();

      if (currentCheckedThreadIds.size === 0) {
        openThread(target);
        return;
      }

      const key = getThreadSelectionKey(target);
      checkThread(key, !currentCheckedThreadIds.has(key));
      selectThread(key);
    },
    [checkThread, consumeSuppressedOpen, openThread, selectThread]
  );
  const handleToggleSelection = useCallback(
    (target: MailThreadSummary): void => {
      const key = getThreadSelectionKey(target);
      checkThread(key, !useMailboxStore.getState().checkedThreadIds.has(key));
      selectThread(key);
    },
    [checkThread, selectThread]
  );
  const handleRowPointerDown = useCallback(
    (target: MailThreadSummary, event: PointerEvent<HTMLButtonElement>) => {
      onRowPointerDown(getThreadSelectionKey(target), event);
    },
    [onRowPointerDown]
  );
  const handleSelectionPointerDown = useCallback(
    (target: MailThreadSummary, event: PointerEvent) => {
      onSelectionPointerDown(getThreadSelectionKey(target), event);
    },
    [onSelectionPointerDown]
  );
  const handleSelectionPointerEnter = useCallback(
    (target: MailThreadSummary) => {
      onSelectionPointerEnter(getThreadSelectionKey(target));
    },
    [onSelectionPointerEnter]
  );
  const handleToggleRead = actions.toggleRead;
  const requestDeleteForever = useCallback(
    async (thread: MailThreadSummary): Promise<void> => {
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
    (thread: MailThreadSummary): void => {
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
  useAppCommand("mailbox.clearSelection", () => {
    clearCheckedThreads();
    selectThread(null);
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
    if (
      loadNextPage !== undefined &&
      shouldLoadNextPage({
        hasLoadError: loadError !== undefined,
        hasNextPage,
        isLoadingNextPage,
        lastVisibleIndex: virtualRows.at(-1)?.index,
        threadCount: threads.length,
      })
    ) {
      void loadNextPage();
    }
  }, [
    hasNextPage,
    isLoadingNextPage,
    loadError,
    loadNextPage,
    threads.length,
    virtualRows,
  ]);

  return (
    <>
      <section
        aria-label={presentation.label}
        className="scroll-fade-y relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4"
        ref={scrollElementRef}
        style={{ paddingBottom: bottomClearance }}
        tabIndex={-1}
      >
        <ThreadListPlaceholderPane
          copy={{
            emptyIcon: presentation.emptyIcon,
            emptyMessage,
            emptyTitle,
            loadError,
            loadErrorTitle,
            loadingTitle,
          }}
          isInitialLoading={isInitialLoading}
          onRetryLoad={onRetryLoad}
          threadCount={threads.length}
        />
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
                  <ThreadListTrailingNote
                    hasNextPage={hasNextPage}
                    loadError={trailingError}
                    onRetryLoad={onRetryLoad}
                    trailingMessage={trailingMessage}
                  />
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
                  mailboxLabel={presentation.mailboxLabel}
                  {...getRowDestructiveActions(
                    thread,
                    handleDeleteForever,
                    actions.trash
                  )}
                  onOpen={handleOpen}
                  onRowPointerDown={handleRowPointerDown}
                  onNotSpam={mailbox === "spam" ? actions.notSpam : undefined}
                  onSelectionPointerDown={handleSelectionPointerDown}
                  onSelectionPointerEnter={handleSelectionPointerEnter}
                  onToggleRead={handleToggleRead}
                  onToggleSelection={handleToggleSelection}
                  position={virtualRow.index + 1}
                  ref={rowVirtualizer.measureElement}
                  setSize={threads.length}
                  showAccount={showAccount}
                  top={virtualRow.start}
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
