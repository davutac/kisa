import { useHotkey } from "@tanstack/react-hotkeys";
import { useVirtualizer } from "@tanstack/react-virtual";
import { InboxIcon } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useEffect, useRef } from "react";

import MailThreadItem from "@/components/mail/thread-item";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import type { ThreadSelectionDirection } from "@/mail/thread-selection";
import {
  getNextThreadSelectionIndex,
  getThreadSelectionKey,
  getVisibleThreadSelectionIndex,
} from "@/mail/thread-selection";
import type { GmailThreadSummary } from "@/shared/ipc/mail";
import {
  useMailboxStore,
  useOpenThreadId,
  useSelectedThreadId,
} from "@/state/mailbox";

interface MailThreadListProps {
  emptyMessage: string;
  hasNextPage?: boolean;
  isInitialLoading: boolean;
  isLoadingNextPage?: boolean;
  loadNextPage?: () => Promise<boolean>;
  onToggleThreadRead?: (thread: GmailThreadSummary) => void;
  onTrashThread?: (thread: GmailThreadSummary) => void;
  reloadRevision: number;
  showAccount?: boolean;
  threads: readonly GmailThreadSummary[];
}

const MailThreadList = ({
  emptyMessage,
  hasNextPage = false,
  isInitialLoading,
  isLoadingNextPage = false,
  loadNextPage,
  onToggleThreadRead,
  onTrashThread,
  reloadRevision,
  showAccount = false,
  threads,
}: MailThreadListProps) => {
  const scrollElementRef = useRef<HTMLElement>(null);
  const listElementRef = useRef<HTMLOListElement>(null);
  const selectedThreadKey = useSelectedThreadId();
  const openThreadId = useOpenThreadId();
  const openThread = useMailboxStore((state) => state.openThread);
  const selectThread = useMailboxStore((state) => state.selectThread);
  const previousReloadRevisionRef = useRef(reloadRevision);
  const rowVirtualizer = useVirtualizer<HTMLElement, HTMLLIElement>({
    count: threads.length + (hasNextPage ? 1 : 0),
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
  // The mailbox stays mounted behind an open thread; its keys must not fire.
  const selectionHotkeysEnabled = threads.length > 0 && openThreadId === null;

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
      getNextThreadSelectionIndex(
        threads.map(getThreadSelectionKey),
        selectedThreadKey,
        direction
      );

    if (nextIndex === null) {
      return;
    }

    const nextThread = threads[nextIndex];

    if (nextThread === undefined) {
      return;
    }

    selectThread(getThreadSelectionKey(nextThread));
    rowVirtualizer.scrollToIndex(nextIndex, { align: "auto" });
  };

  useHotkey(
    "Tab",
    () => {
      moveSelection(1);
    },
    { enabled: selectionHotkeysEnabled }
  );
  useHotkey(
    "Shift+Tab",
    () => {
      moveSelection(-1);
    },
    { enabled: selectionHotkeysEnabled }
  );
  useHotkey(
    "ArrowDown",
    () => {
      moveSelection(1);
    },
    { enabled: selectionHotkeysEnabled }
  );
  useHotkey(
    "ArrowUp",
    () => {
      moveSelection(-1);
    },
    { enabled: selectionHotkeysEnabled }
  );
  useHotkey(
    "J",
    () => {
      moveSelection(1);
    },
    { enabled: selectionHotkeysEnabled }
  );
  useHotkey(
    "K",
    () => {
      moveSelection(-1);
    },
    { enabled: selectionHotkeysEnabled }
  );
  useHotkey(
    "Escape",
    () => {
      selectThread(null);
    },
    {
      // The open thread owns Escape while it is up, so it closes before the
      // mailbox underneath drops its selection.
      enabled: selectedThreadKey !== null && openThreadId === null,
      requireReset: true,
    }
  );
  useHotkey(
    "Enter",
    () => {
      if (selectedThread === undefined) {
        return;
      }

      openThread(getThreadSelectionKey(selectedThread));
    },
    {
      enabled: selectedThread !== undefined && openThreadId === null,
      requireReset: true,
    }
  );

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
    <section
      aria-label="Inbox"
      className="scroll-fade-y relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4"
      ref={scrollElementRef}
      tabIndex={-1}
    >
      {threads.length === 0 ? (
        <Empty aria-live="polite" className="absolute inset-4 w-auto border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {isInitialLoading ? <Spinner /> : <InboxIcon />}
            </EmptyMedia>
            <EmptyTitle>
              {isInitialLoading ? "Loading email…" : "No email"}
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
                  Loading more email…
                </p>
              </li>
            ) : (
              <MailThreadItem
                data-index={virtualRow.index}
                isSelected={getThreadSelectionKey(thread) === selectedThreadKey}
                key={virtualRow.key}
                onToggleRead={onToggleThreadRead}
                onTrash={onTrashThread}
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
  );
};

export default MailThreadList;
