import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";
import { toast } from "sonner";

import MailThreadList from "@/components/mail/thread-list";
import MailThreadView from "@/components/mail/thread-view";
import { useHotkeyLayer } from "@/hotkeys";
import { useMailboxReloadRevision } from "@/mail/mailbox-reload";
import { parseThreadSelectionKey } from "@/mail/thread-selection";
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
  useShowUnread,
} from "@/state/mailbox";

export const Route = createFileRoute("/")({ component: HomeRoute });

interface MailboxEmptyState {
  message: string;
  title: string;
}

function getEmptyState(
  mailbox: GmailMailbox,
  unreadOnly: boolean
): MailboxEmptyState {
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

  return {
    message: unreadOnly
      ? "Nothing unread. The tiny red badge has been defeated."
      : "No mail here yet. Kisa is checking the post in the background.",
    title: unreadOnly ? "Inbox zero, achieved" : "A rare sight: inbox zero",
  };
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
      (entry.status === "running" || entry.status === "queued") &&
      accountIds.includes(entry.accountId)
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

function HomeRoute() {
  const { accountIds, selectedAccountId } = useMailboxAccountScope();
  const mailbox = useMailbox();
  const showUnread = useShowUnread();
  const reloadRevision = useMailboxReloadRevision();
  const openThreadId = useOpenThreadId();
  const closeThread = useMailboxStore((state) => state.closeThread);
  const windowApi = getWindowApi();
  const openThread = parseThreadSelectionKey(openThreadId ?? "");
  const {
    hasNextPage,
    isInitialLoading,
    isLoadingNextPage,
    loadNextPage,
    threads,
  } = useMailboxThreads({
    accountIds,
    mailbox,
    reloadRevision,
    unreadOnly: showUnread,
  });
  const threadActions = useThreadActions();
  const { deleteSpam, notSpam, setLabel, toggleRead, trash } = threadActions;
  const indexProgress = useMailIndexProgress();
  const emptyState = getEmptyState(mailbox, showUnread);
  const indexingMessage =
    mailbox === "inbox"
      ? getIndexingMessage(indexProgress, accountIds)
      : undefined;
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

  // The mailbox stays mounted underneath so its scroll position and virtualiser
  // survive reading a thread without any restoration bookkeeping.
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <MailThreadList
        actions={threadActions}
        emptyMessage={emptyState.message}
        emptyTitle={emptyState.title}
        hasNextPage={hasNextPage}
        indexingMessage={indexingMessage}
        isInitialLoading={isInitialLoading}
        isLoadingNextPage={isLoadingNextPage}
        loadNextPage={loadNextPage}
        mailbox={mailbox}
        reloadRevision={reloadRevision}
        showAccount={selectedAccountId === null}
        threads={threads}
      />
      {openThread === null ? null : (
        <div className="bg-background absolute inset-0 z-10 overflow-x-hidden overflow-y-auto">
          <MailThreadView
            accountId={openThread.accountId}
            closeLabel={mailbox === "spam" ? "Back to spam" : undefined}
            key={`${openThread.accountId}:${openThread.threadId}`}
            onClose={closeThread}
            onDeleteSpam={deleteSpam}
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
