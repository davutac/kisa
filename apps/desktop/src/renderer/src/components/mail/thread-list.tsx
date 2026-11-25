import { createController } from "@ui-sdk/core";
import type { VirtualItem } from "@ui-sdk/core";
import {
  CircleAlertIcon,
  InboxIcon,
  SearchIcon,
  SendIcon,
  ShieldAlertIcon,
  StarIcon,
  TagIcon,
  Trash2Icon,
} from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { PinnedDayHeading } from "@/components/mail/day-heading";
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
import { useCalendar } from "@/hooks/use-calendar";
import type { Calendar } from "@/hooks/use-calendar";
import { useInstanceValue } from "@/hooks/use-instance-value";
import { useAppCommand, useHotkeyLayer } from "@/hotkeys";
import { cn } from "@/lib/utils";
import { getMailboxSystemLabel, hasStarredLabel } from "@/mail/label";
import { formatMailDayHeading } from "@/mail/mail-date";
import { isLabelPlace } from "@/mail/mailbox-place";
import type { MailboxPlace } from "@/mail/mailbox-place";
import {
  getThreadListPlaceholder,
  shouldLoadNextPage,
} from "@/mail/mailbox-threads-load";
import type { ThreadListPlaceholder } from "@/mail/mailbox-threads-load";
import {
  canArchiveThread,
  canReportThreadSpam,
  canStarThread,
  getBulkStarTarget,
} from "@/mail/thread-action-availability";
import { isFirstOfDay, isNewestFirst } from "@/mail/thread-day-headings";
import {
  getBulkThreadDestructiveAction,
  getThreadDestructiveAction,
} from "@/mail/thread-destructive-action";
import { getThreadSelectionKey } from "@/mail/thread-selection";
import { useOpenThread } from "@/mail/use-open-thread";
import type { ThreadActions } from "@/mail/use-thread-actions";
import type {
  MailListActivateDetails,
  MailListController,
} from "@/primitives/mail-list";
import { MailListRoot } from "@/primitives/mail-list-root";
import type { MailThreadSummary } from "@/shared/ipc/mail";
import {
  useCheckedThreadIds,
  useMailboxStore,
  useOpenThreadId,
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

const renderPinnedDayHeading = (rows: readonly VirtualItem[]) => (
  <PinnedDayHeading revision={rows} />
);

// The pinned heading marks the top edge of a grouped list, so only its
// bottom fades.
const getScrollerClassName = (isGroupedByDay: boolean) =>
  cn(
    "scroll-fade-y relative min-h-0 flex-1 overflow-x-hidden! outline-none",
    isGroupedByDay && "[--scroll-fade-t-size:0px]"
  );

const getPinnedDayHeading = (isGroupedByDay: boolean, threadCount: number) =>
  isGroupedByDay && threadCount > 0 ? renderPinnedDayHeading : undefined;

/** A rendered row's day, and whether it opens that day, in a grouped list. */
const getRowDay = (
  threads: readonly MailThreadSummary[],
  index: number,
  thread: MailThreadSummary,
  calendar: Calendar
) => ({
  day: formatMailDayHeading(thread.latestAt, calendar),
  isFirstOfDay:
    threads[index] === thread && isFirstOfDay(threads, index, calendar),
});

const getRowDestructiveActions = (
  thread: MailThreadSummary,
  onDeleteForever: (thread: MailThreadSummary) => void,
  onTrash: ThreadActions["trash"]
) =>
  getThreadDestructiveAction(thread.places) === "deleteForever"
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

  if (mailbox === "starred") {
    return { emptyIcon: <StarIcon />, label: "Starred", mailboxLabel };
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

const conversationCount = (count: number): string =>
  `${count} conversation${count === 1 ? "" : "s"}`;

const selectedMessage = (count: number): string =>
  count === 0 ? "Selection cleared" : `${conversationCount(count)} selected`;

/**
 * Archive, Star and Report spam for the focused conversation or the checked
 * ones, through their shortcuts, and the same actions for the selection bar.
 * A selection acts on the conversations each applies to: Archive on those in
 * the Inbox, so Undo returns only what left it.
 */
const useMailboxThreadCommands = ({
  actions,
  bulkDestructiveAction,
  checkedThreads,
  selectedThread,
}: {
  readonly actions: ThreadActions;
  readonly bulkDestructiveAction: ReturnType<
    typeof getBulkThreadDestructiveAction
  >;
  readonly checkedThreads: readonly MailThreadSummary[];
  readonly selectedThread: MailThreadSummary | undefined;
}) => {
  const toggleStar = useCallback(
    (thread: MailThreadSummary): void => {
      actions.toggleStar({
        accountId: thread.accountId,
        isStarred: hasStarredLabel(thread.labels),
        threadId: thread.threadId,
      });
    },
    [actions]
  );

  const isChecking = checkedThreads.length > 0;

  const archivable = checkedThreads.filter((thread) =>
    canArchiveThread(thread.places)
  );

  const starrable = checkedThreads.filter((thread) =>
    canStarThread(thread.places)
  );

  const canReportChecked = bulkDestructiveAction === "trash";

  /** Whether a command has a target: the selection, or the focused row. */
  const hasTarget = (
    hasCheckedTarget: boolean,
    appliesTo: (places: readonly string[]) => boolean
  ): boolean =>
    isChecking
      ? hasCheckedTarget
      : selectedThread !== undefined && appliesTo(selectedThread.places);

  const archiveChecked = (): void => {
    actions.bulkArchive(archivable);
  };

  const toggleCheckedStar = (): void => {
    actions.bulkSetStarred(starrable, getBulkStarTarget(starrable));
  };

  const reportCheckedSpam = (): void => {
    actions.bulkReportSpam(checkedThreads);
  };

  useAppCommand(
    "mailbox.archiveThread",
    () => {
      if (isChecking) {
        archiveChecked();
      } else if (selectedThread !== undefined) {
        actions.archive(selectedThread);
      }
    },
    { enabled: hasTarget(archivable.length > 0, canArchiveThread) }
  );
  useAppCommand(
    "mailbox.toggleThreadStar",
    () => {
      if (isChecking) {
        toggleCheckedStar();
      } else if (selectedThread !== undefined) {
        toggleStar(selectedThread);
      }
    },
    { enabled: hasTarget(starrable.length > 0, canStarThread) }
  );
  useAppCommand(
    "mailbox.reportSpam",
    () => {
      if (isChecking) {
        reportCheckedSpam();
      } else if (selectedThread !== undefined) {
        actions.reportSpam(selectedThread);
      }
    },
    { enabled: hasTarget(canReportChecked, canReportThreadSpam) }
  );

  return {
    selectionBar: {
      isStarred: !getBulkStarTarget(starrable),
      onArchive: archivable.length === 0 ? undefined : archiveChecked,
      onReportSpam: canReportChecked ? reportCheckedSpam : undefined,
      onToggleStar: starrable.length === 0 ? undefined : toggleCheckedStar,
    },
    toggleStar,
  };
};

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
  const list = useInstanceValue(() => createController<MailListController>());
  const selectedThreadKey = useSelectedThreadId();
  const checkedThreadIds = useCheckedThreadIds();
  // A conversation read over the list covers it, so the list keeps no keys.
  const isCovered = useOpenThreadId() !== null;
  const openThread = useOpenThread();
  const checkThread = useMailboxStore((state) => state.checkThread);

  const clearCheckedThreads = useMailboxStore(
    (state) => state.clearCheckedThreads
  );

  const setCheckedThreads = useMailboxStore((state) => state.setCheckedThreads);
  const selectThread = useMailboxStore((state) => state.selectThread);
  const previousScrollResetKeyRef = useRef(scrollResetKey);

  const threadKeys = useMemo(
    () => threads.map((thread) => getThreadSelectionKey(thread)),
    [threads]
  );

  const threadsByKey = useMemo(
    () =>
      new Map(threads.map((thread) => [getThreadSelectionKey(thread), thread])),
    [threads]
  );

  const checkedKeys = useMemo(() => [...checkedThreadIds], [checkedThreadIds]);
  const calendar = useCalendar();
  const isGroupedByDay = useMemo(() => isNewestFirst(threads), [threads]);
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
  const [lastRenderedIndex, setLastRenderedIndex] = useState<number>();

  const selectedThread =
    selectedThreadKey === null
      ? undefined
      : threadsByKey.get(selectedThreadKey);

  const checkedThreads = useMemo(
    () =>
      threads.filter((thread) =>
        checkedThreadIds.has(getThreadSelectionKey(thread))
      ),
    [checkedThreadIds, threads]
  );

  const bulkDestructiveAction = getBulkThreadDestructiveAction(checkedThreads);

  // Checked state is read at event time, not captured, so these props stay
  // stable and toggling one row doesn't re-render the memoized others.
  const handleActivate = useCallback(
    (key: string, { source }: MailListActivateDetails): void => {
      const target = threadsByKey.get(key);
      const { checkedThreadIds: checked } = useMailboxStore.getState();

      if (target === undefined) {
        return;
      }

      if (checked.size === 0 || source === "agent") {
        openThread(target);

        return;
      }

      // With conversations checked a click adds or removes the row, as X
      // does; Enter opens nothing until the selection is cleared.
      if (source === "pointer") {
        checkThread(key, !checked.has(key));
        selectThread(key);
      }
    },
    [checkThread, openThread, selectThread, threadsByKey]
  );

  const handleCheckedChange = useCallback(
    (keys: readonly string[]): void => {
      setCheckedThreads(new Set(keys));
    },
    [setCheckedThreads]
  );

  const handleToggleSelection = useCallback(
    (target: MailThreadSummary): void => {
      const key = getThreadSelectionKey(target);
      checkThread(key, !useMailboxStore.getState().checkedThreadIds.has(key));
      selectThread(key);
    },
    [checkThread, selectThread]
  );

  const labelOf = useCallback(
    (key: string): string => threadsByKey.get(key)?.subject ?? key,
    [threadsByKey]
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
      actions.bulkDeleteForever(checkedThreads);
    }
  }, [actions, checkedThreads, confirm]);

  const requestBulkTrash = useCallback((): void => {
    actions.bulkTrash(checkedThreads);
  }, [actions, checkedThreads]);

  const { selectionBar, toggleStar: handleToggleStar } =
    useMailboxThreadCommands({
      actions,
      bulkDestructiveAction,
      checkedThreads,
      selectedThread,
    });

  useHotkeyLayer("mailbox", true);
  useAppCommand(
    "mailbox.nextThread",
    () => {
      list.move(1);
    },
    { enabled: threads.length > 0 }
  );
  useAppCommand(
    "mailbox.previousThread",
    () => {
      list.move(-1);
    },
    { enabled: threads.length > 0 }
  );
  useAppCommand("mailbox.clearSelection", () => {
    list.clear();
  });
  useAppCommand(
    "mailbox.toggleThreadSelection",
    () => {
      if (selectedThreadKey !== null) {
        list.toggle(selectedThreadKey);
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
        actions.bulkSetReadState(checkedThreads, markUnread);
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
          requestBulkTrash();
        }
      } else if (selectedThread !== undefined) {
        if (
          getThreadDestructiveAction(selectedThread.places) === "deleteForever"
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
        lastVisibleIndex: lastRenderedIndex,
        threadCount: threads.length,
      })
    ) {
      void loadNextPage();
    }
  }, [
    hasNextPage,
    isLoadingNextPage,
    lastRenderedIndex,
    loadError,
    loadNextPage,
    threads.length,
  ]);

  return (
    // Positioned and clipped, but not a scroll container: the selection bar
    // rests against this box, so nothing it holds can lengthen the scrolling
    // <main>. Tooltips and the label menu show in the top layer, which the
    // clip leaves alone.
    <div className="relative flex min-h-0 flex-1 flex-col overflow-clip">
      <MailListRoot
        after={
          hasTrailingRow ? (
            <div className="py-4">
              <ThreadListTrailingNote
                hasNextPage={hasNextPage}
                loadError={trailingError}
                onRetryLoad={onRetryLoad}
                trailingMessage={trailingMessage}
              />
            </div>
          ) : null
        }
        aria-label={presentation.label}
        before={
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
        }
        checkable
        checked={checkedKeys}
        className={getScrollerClassName(isGroupedByDay)}
        controller={list}
        current={selectedThreadKey}
        estimate={88}
        gridLabel="Conversations"
        inert={isCovered}
        keys={threadKeys}
        labelOf={labelOf}
        onActivate={handleActivate}
        onCheckedChange={handleCheckedChange}
        onCurrentChange={selectThread}
        onRowsRendered={(rows) => {
          setLastRenderedIndex(rows.at(-1)?.index);
        }}
        pinned={getPinnedDayHeading(isGroupedByDay, threads.length)}
        ref={scrollElementRef}
        rowCount={threads.length}
        selectedMessage={selectedMessage}
        style={{ paddingBottom: bottomClearance }}
        tabIndex={-1}
      >
        {(rows) => (
          <AnimatePresence initial={false}>
            {rows.map((row) => {
              const thread = threadsByKey.get(row.key);

              return thread === undefined ? null : (
                <MailThreadItem
                  {...(isGroupedByDay
                    ? getRowDay(threads, row.index, thread, calendar)
                    : undefined)}
                  hasCheckedThreads={checkedThreadIds.size > 0}
                  isChecked={checkedThreadIds.has(row.key)}
                  isSelected={row.key === selectedThreadKey}
                  key={row.key}
                  mailboxLabel={presentation.mailboxLabel}
                  {...getRowDestructiveActions(
                    thread,
                    handleDeleteForever,
                    actions.trash
                  )}
                  onArchive={
                    canArchiveThread(thread.places)
                      ? actions.archive
                      : undefined
                  }
                  onNotSpam={mailbox === "spam" ? actions.notSpam : undefined}
                  onToggleRead={handleToggleRead}
                  onToggleSelection={handleToggleSelection}
                  onToggleStar={
                    canStarThread(thread.places) ? handleToggleStar : undefined
                  }
                  showAccount={showAccount}
                  top={row.start}
                  thread={thread}
                />
              );
            })}
          </AnimatePresence>
        )}
      </MailListRoot>
      <AnimatePresence initial={false}>
        {checkedThreads.length === 0 ? null : (
          <ThreadSelectionBar
            actions={actions}
            {...selectionBar}
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
    </div>
  );
};

export default MailThreadList;
