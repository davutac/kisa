import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";

import MailboxLabelBar from "@/components/mail/mailbox-label-bar";
import MailThreadList from "@/components/mail/thread-list";
import type { MailThreadListProps } from "@/components/mail/thread-list";
import MailThreadView from "@/components/mail/thread-view";
import { useHotkeyLayer } from "@/hotkeys";
import { useMailboxReloadRevision } from "@/mail/mailbox-reload";
import { parseThreadSelectionKey } from "@/mail/thread-selection";
import { useInlineMailSearch } from "@/mail/use-inline-mail-search";
import { useMailIndexProgress } from "@/mail/use-mail-index-progress";
import { useMailboxAccountScope } from "@/mail/use-mailbox-account-scope";
import { useMailboxThreads } from "@/mail/use-mailbox-threads";
import { useThreadActions } from "@/mail/use-thread-actions";
import { getWindowApi } from "@/platform/desktop";
import type { GmailIndexProgress, GmailMailbox } from "@/shared/ipc/mail";
import {
  useMailbox,
  useMailboxStore,
  useOpenThreadId,
  useSelectedLabelNames,
  useShowUnread,
} from "@/state/mailbox";

export const Route = createFileRoute("/")({ component: HomeRoute });

interface MailboxEmptyState {
  message: string;
  title: string;
}

function getEmptyState(
  mailbox: GmailMailbox,
  unreadOnly: boolean,
  hasLabelFilter: boolean
): MailboxEmptyState {
  if (hasLabelFilter) {
    return {
      message: "Try turning off one of the selected labels.",
      title: "No conversations have every selected label",
    };
  }

  if (mailbox === "spam") {
    return unreadOnly
      ? {
          message: "You've caught up with the suspicious characters.",
          title: "Nothing new to investigate",
        }
      : {
          message: "The internet is behaving. For now.",
          title: "Suspiciously quiet",
        };
  }

  if (mailbox === "sent") {
    return {
      message: "Messages you send will appear here.",
      title: "No sent conversations yet",
    };
  }

  if (mailbox === "trash") {
    return {
      message: "Conversations you delete will appear here.",
      title: "Trash is empty",
    };
  }

  return {
    message: unreadOnly
      ? "Nothing unread. The tiny red badge has been defeated."
      : "No mail here yet. Kisa is checking the post in the background.",
    title: unreadOnly ? "Inbox zero, achieved" : "A rare sight: inbox zero",
  };
}

function getThreadCloseLabel(mailbox: GmailMailbox): string | undefined {
  if (mailbox === "spam") {
    return "Back to spam";
  }
  if (mailbox === "sent") {
    return "Back to sent";
  }
  return mailbox === "trash" ? "Back to trash" : undefined;
}

const MONTH_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});

/**
 * Reaching the bottom of a mailbox that is still being indexed is not the end
 * of the mail, so the row says how far back the index has reached instead of
 * going quiet.
 */
function getIndexingMessage(
  progress: readonly GmailIndexProgress[],
  accountIds: readonly string[]
): string | undefined {
  const running = progress.filter(
    (entry) =>
      entry.status === "running" && accountIds.includes(entry.accountId)
  );

  if (running.length === 0) {
    return undefined;
  }

  const oldest = running
    .map((entry) => entry.oldestIndexedAt)
    .filter((value): value is number => value !== undefined);

  return oldest.length === 0
    ? "Indexing your mail…"
    : `Indexing your mail — back to ${MONTH_FORMAT.format(new Date(Math.min(...oldest)))}`;
}

type ThreadListView = Omit<MailThreadListProps, "actions">;

function getSearchThreadListView(
  search: ReturnType<typeof useInlineMailSearch>
): ThreadListView {
  const { isReady } = search;

  return {
    emptyMessage: isReady
      ? "Try another word or remove a filter."
      : "Search starts after two characters.",
    emptyTitle: isReady ? "No indexed mail matches" : "Keep typing",
    isInitialLoading: isReady && search.results.isLoading,
    loadingTitle: "Searching your mail…",
    mailbox: search.mailbox,
    scrollResetKey: search.resetKey,
    searchResults: true,
    showAccount: search.showAccount,
    threads: search.results.threads,
    trailingMessage: search.results.hasMore
      ? "Showing the top 200 matches"
      : undefined,
  };
}

function getMailboxThreadListView({
  emptyState,
  hasNextPage,
  indexingMessage,
  isInitialLoading,
  isLoadingNextPage,
  loadNextPage,
  mailbox,
  reloadRevision,
  selectedAccountId,
  threads,
}: {
  readonly emptyState: MailboxEmptyState;
  readonly hasNextPage: boolean;
  readonly indexingMessage?: string;
  readonly isInitialLoading: boolean;
  readonly isLoadingNextPage: boolean;
  readonly loadNextPage: () => Promise<boolean>;
  readonly mailbox: GmailMailbox;
  readonly reloadRevision: number | string;
  readonly selectedAccountId: string | null;
  readonly threads: MailThreadListProps["threads"];
}): ThreadListView {
  return {
    emptyMessage: emptyState.message,
    emptyTitle: emptyState.title,
    hasNextPage,
    isInitialLoading,
    isLoadingNextPage,
    loadNextPage,
    mailbox,
    scrollResetKey: reloadRevision,
    searchResults: false,
    showAccount: selectedAccountId === null,
    threads,
    trailingMessage: indexingMessage,
  };
}

function HomeRoute() {
  const { accountIds, selectedAccountId } = useMailboxAccountScope();
  const mailbox = useMailbox();
  const showUnread = useShowUnread();
  const selectedLabelNames = useSelectedLabelNames();
  const reloadRevision = useMailboxReloadRevision();
  const openThreadId = useOpenThreadId();
  const closeThread = useMailboxStore((state) => state.closeThread);
  const clearCheckedThreads = useMailboxStore(
    (state) => state.clearCheckedThreads
  );
  const selectThread = useMailboxStore((state) => state.selectThread);
  const windowApi = getWindowApi();
  const openThread = parseThreadSelectionKey(openThreadId ?? "");
  const mailboxThreads = useMailboxThreads({
    accountIds,
    labelNames: selectedLabelNames,
    mailbox,
    reloadRevision,
    unreadOnly: showUnread,
  });
  const search = useInlineMailSearch(
    accountIds,
    mailbox,
    showUnread,
    selectedLabelNames
  );
  const {
    hasNextPage,
    isInitialLoading,
    isLoadingNextPage,
    loadNextPage,
    threads,
  } = mailboxThreads;
  const threadActions = useThreadActions();
  const { deleteForever, notSpam, setLabel, toggleRead, trash } = threadActions;
  const indexProgress = useMailIndexProgress();
  const emptyState = getEmptyState(
    mailbox,
    showUnread,
    selectedLabelNames.length > 0
  );
  const indexingMessage =
    mailbox === "spam"
      ? undefined
      : getIndexingMessage(indexProgress, accountIds);
  const listView = search.isShowingResults
    ? getSearchThreadListView(search)
    : getMailboxThreadListView({
        emptyState,
        hasNextPage,
        indexingMessage,
        isInitialLoading,
        isLoadingNextPage,
        loadNextPage,
        mailbox,
        reloadRevision: JSON.stringify([reloadRevision, selectedLabelNames]),
        selectedAccountId,
        threads,
      });
  const popOutThread = useCallback(
    async (thread: { accountId: string; threadId: string }): Promise<void> => {
      if (windowApi === undefined) {
        return;
      }

      try {
        const reply = await windowApi.openThread(thread);

        if (!reply.ok) {
          toast.error(reply.error);
          return;
        }

        closeThread();
      } catch {
        toast.error("Could not open the conversation in a new window");
      }
    },
    [closeThread, windowApi]
  );

  useHotkeyLayer("thread", openThread !== null);

  useEffect(() => {
    if (!search.isShowingResults) {
      return;
    }

    closeThread();
    clearCheckedThreads();
    selectThread(null);
  }, [
    clearCheckedThreads,
    closeThread,
    search.isShowingResults,
    search.resetKey,
    selectThread,
  ]);

  // The mailbox stays mounted underneath so its scroll position and virtualiser
  // survive reading a thread without any restoration bookkeeping.
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <MailboxLabelBar />
      <MailThreadList actions={threadActions} {...listView} />
      {openThread === null ? null : (
        <div className="bg-background absolute inset-0 z-10 overflow-x-hidden overflow-y-auto">
          <MailThreadView
            accountId={openThread.accountId}
            closeLabel={getThreadCloseLabel(mailbox)}
            key={`${openThread.accountId}:${openThread.threadId}`}
            onClose={closeThread}
            onDeleteForever={deleteForever}
            onPopOut={windowApi === undefined ? undefined : popOutThread}
            onNotSpam={notSpam}
            onSetLabel={setLabel}
            onToggleRead={toggleRead}
            onTrash={trash}
            threadId={openThread.threadId}
          />
        </div>
      )}
    </div>
  );
}
