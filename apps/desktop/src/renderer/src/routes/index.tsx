import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";

import MailboxBreadcrumb from "@/components/mail/mailbox-breadcrumb";
import MailThreadList from "@/components/mail/thread-list";
import type { MailThreadListProps } from "@/components/mail/thread-list";
import MailThreadView from "@/components/mail/thread-view";
import type { MailThreadTitlebarProps } from "@/components/mail/thread-view";
import { useHotkeyLayer } from "@/hotkeys";
import { getMailboxPlaceKey, isLabelPlace } from "@/mail/mailbox-place";
import type { MailboxPlace } from "@/mail/mailbox-place";
import { useMailboxReloadRevision } from "@/mail/mailbox-reload";
import { parseThreadSelectionKey } from "@/mail/thread-selection";
import { useInlineMailSearch } from "@/mail/use-inline-mail-search";
import { useMailIndexProgress } from "@/mail/use-mail-index-progress";
import { useMailboxAccountScope } from "@/mail/use-mailbox-account-scope";
import { useMailboxThreads } from "@/mail/use-mailbox-threads";
import { useThreadActions } from "@/mail/use-thread-actions";
import { getWindowApi } from "@/platform/desktop";
import type { MailIndexProgress } from "@/shared/ipc/mail";
import {
  useMailbox,
  useMailboxStore,
  useOpenThreadId,
  useShowUnread,
} from "@/state/mailbox";

export const Route = createFileRoute("/")({ component: HomeRoute });

interface MailboxEmptyState {
  message: string;
  title: string;
}

function getEmptyState(
  mailbox: MailboxPlace,
  unreadOnly: boolean
): MailboxEmptyState {
  if (isLabelPlace(mailbox)) {
    return unreadOnly
      ? {
          message: `Everything labeled ${mailbox.label} has been read.`,
          title: "Nothing unread here",
        }
      : {
          message: `Conversations labeled ${mailbox.label} will appear here.`,
          title: "No conversations with this label",
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

function getThreadCloseLabel(mailbox: MailboxPlace): string | undefined {
  if (isLabelPlace(mailbox)) {
    return `Back to ${mailbox.label}`;
  }
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
  progress: readonly MailIndexProgress[],
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

/**
 * The titlebar while a conversation is open over the mailbox: the mailbox's
 * breadcrumb, whose mailbox crumb leads back to the list, then the subject,
 * with the conversation's actions on the trailing side.
 */
function OpenThreadTitlebar({ actions, subject }: MailThreadTitlebarProps) {
  const mailbox = useMailbox();
  const closeThread = useMailboxStore((state) => state.closeThread);

  return (
    <MailboxBreadcrumb
      actions={actions}
      mailbox={mailbox}
      thread={{
        backLabel: getThreadCloseLabel(mailbox) ?? "Back to inbox",
        onBack: closeThread,
        subject,
      }}
    />
  );
}

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
  loadError,
  loadNextPage,
  mailbox,
  onRetryLoad,
  reloadRevision,
  showAccount,
  threads,
}: {
  readonly emptyState: MailboxEmptyState;
  readonly hasNextPage: boolean;
  readonly indexingMessage?: string;
  readonly isInitialLoading: boolean;
  readonly isLoadingNextPage: boolean;
  readonly loadError: string | undefined;
  readonly loadNextPage: () => Promise<boolean>;
  readonly mailbox: MailboxPlace;
  readonly onRetryLoad: () => void;
  readonly reloadRevision: number | string;
  /** Only when rows from several accounts can mix; one account needs no badge. */
  readonly showAccount: boolean;
  readonly threads: MailThreadListProps["threads"];
}): ThreadListView {
  return {
    emptyMessage: emptyState.message,
    emptyTitle: emptyState.title,
    hasNextPage,
    isInitialLoading,
    isLoadingNextPage,
    loadError,
    loadNextPage,
    mailbox,
    onRetryLoad,
    scrollResetKey: reloadRevision,
    searchResults: false,
    showAccount,
    threads,
    trailingMessage: indexingMessage,
  };
}

function HomeRoute() {
  const { accountIds } = useMailboxAccountScope();
  const mailbox = useMailbox();
  const showUnread = useShowUnread();
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
    mailbox,
    reloadRevision,
    unreadOnly: showUnread,
  });
  const search = useInlineMailSearch(accountIds, mailbox, showUnread);
  const {
    error: loadError,
    hasNextPage,
    isInitialLoading,
    isLoadingNextPage,
    loadNextPage,
    retry: onRetryLoad,
    threads,
  } = mailboxThreads;
  const threadActions = useThreadActions();
  const { deleteForever, notSpam, setLabel, toggleRead, trash } = threadActions;
  const indexProgress = useMailIndexProgress();
  const emptyState = getEmptyState(mailbox, showUnread);
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
        loadError,
        loadNextPage,
        mailbox,
        onRetryLoad,
        // Each place starts at the top of its list.
        reloadRevision: JSON.stringify([
          reloadRevision,
          getMailboxPlaceKey(mailbox),
        ]),
        showAccount: accountIds.length > 1,
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
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Each new search scope closes the open thread and clears the selection.
    search.resetKey,
    selectThread,
  ]);

  // The mailbox stays mounted underneath so its scroll position and virtualiser
  // survive reading a thread without any restoration bookkeeping. Its
  // breadcrumb names the place, which the sidebar may be hidden from showing;
  // an open thread extends it with its subject and actions.
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {openThread === null ? <MailboxBreadcrumb mailbox={mailbox} /> : null}
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
            titlebar={OpenThreadTitlebar}
          />
        </div>
      )}
    </div>
  );
}
