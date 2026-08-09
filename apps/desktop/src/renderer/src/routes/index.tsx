import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";

import MailThreadList from "@/components/mail/thread-list";
import MailThreadView from "@/components/mail/thread-view";
import { useHotkeyLayer } from "@/hotkeys";
import { useMailboxReloadRevision } from "@/mail/mailbox-reload";
import { parseThreadSelectionKey } from "@/mail/thread-selection";
import { useMailIndexProgress } from "@/mail/use-mail-index-progress";
import { useMailboxThreads } from "@/mail/use-mailbox-threads";
import { useThreadActions } from "@/mail/use-thread-actions";
import { getWindowApi } from "@/platform/desktop";
import type { GmailIndexProgress } from "@/shared/ipc/mail";
import { useGoogleAccounts } from "@/state/google-accounts";
import {
  useOpenThreadId,
  useMailboxStore,
  useSelectedAccountId,
  useShowUnread,
} from "@/state/mailbox";

export const Route = createFileRoute("/")({ component: HomeRoute });

function getEmptyMessage(unreadOnly: boolean): string {
  return unreadOnly
    ? "No unread email."
    : "No cached inbox messages yet. Email is fetched in the background.";
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
  const accounts = useGoogleAccounts();
  const showUnread = useShowUnread();
  const selectedAccountId = useSelectedAccountId();
  const reloadRevision = useMailboxReloadRevision();
  const openThreadId = useOpenThreadId();
  const closeThread = useMailboxStore((state) => state.closeThread);
  const windowApi = getWindowApi();
  const openThread = parseThreadSelectionKey(openThreadId ?? "");
  const knownAccountId = accounts.some(
    ({ email }) => email === selectedAccountId
  )
    ? selectedAccountId
    : null;
  const accountIds = useMemo(
    () =>
      knownAccountId === null
        ? accounts.map(({ email }) => email)
        : [knownAccountId],
    [accounts, knownAccountId]
  );
  const {
    hasNextPage,
    isInitialLoading,
    isLoadingNextPage,
    loadNextPage,
    threads,
  } = useMailboxThreads(accountIds, showUnread, reloadRevision);
  const { toggleRead, trash } = useThreadActions();
  const indexProgress = useMailIndexProgress();
  const indexingMessage = getIndexingMessage(indexProgress, accountIds);
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
        emptyMessage={getEmptyMessage(showUnread)}
        hasNextPage={hasNextPage}
        indexingMessage={indexingMessage}
        isInitialLoading={isInitialLoading}
        isLoadingNextPage={isLoadingNextPage}
        loadNextPage={loadNextPage}
        onToggleThreadRead={toggleRead}
        onTrashThread={trash}
        reloadRevision={reloadRevision}
        showAccount={knownAccountId === null}
        threads={threads}
      />
      {openThread === null ? null : (
        <div className="bg-background absolute inset-0 z-10 overflow-x-hidden overflow-y-auto">
          <MailThreadView
            accountId={openThread.accountId}
            key={`${openThread.accountId}:${openThread.threadId}`}
            onClose={closeThread}
            onPopOut={windowApi === undefined ? undefined : popOutThread}
            onToggleRead={toggleRead}
            onTrash={trash}
            threadId={openThread.threadId}
          />
        </div>
      )}
    </div>
  );
}
