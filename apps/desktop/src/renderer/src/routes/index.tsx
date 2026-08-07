import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import MailThreadList from "@/components/mail/thread-list";
import MailThreadView from "@/components/mail/thread-view";
import { useMailboxReloadRevision } from "@/mail/mailbox-reload";
import { useDebouncedSearchQuery } from "@/mail/search";
import { parseThreadSelectionKey } from "@/mail/thread-selection";
import { useMailIndexProgress } from "@/mail/use-mail-index-progress";
import { useMailboxThreads } from "@/mail/use-mailbox-threads";
import { useThreadActions } from "@/mail/use-thread-actions";
import type { GmailIndexProgress } from "@/shared/ipc/mail";
import { useGoogleAccounts } from "@/state/google-accounts";
import {
  useOpenThreadId,
  useSelectedAccountId,
  useShowUnread,
} from "@/state/mailbox";

const getEmptyMessage = (query: string, unreadOnly: boolean): string => {
  if (query.length > 0) {
    return unreadOnly
      ? `No unread email matches “${query}”.`
      : `No email matches “${query}”.`;
  }

  return unreadOnly
    ? "No unread email."
    : "No cached inbox messages yet. Email is fetched in the background.";
};

const MONTH_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});

/**
 * Reaching the bottom of a mailbox that is still being indexed is not the end
 * of the mail, so the row says how far back the index has reached instead of
 * going quiet. Searching is excluded: that path pages Gmail directly and is not
 * bounded by the index.
 */
const getIndexingMessage = (
  progress: readonly GmailIndexProgress[],
  accountIds: readonly string[],
  query: string
): string | undefined => {
  if (query.length > 0) {
    return undefined;
  }

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
};

const HomeRoute = () => {
  const accounts = useGoogleAccounts();
  const query = useDebouncedSearchQuery();
  const showUnread = useShowUnread();
  const selectedAccountId = useSelectedAccountId();
  const reloadRevision = useMailboxReloadRevision();
  const openThread = parseThreadSelectionKey(useOpenThreadId() ?? "");
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
    patchThread,
    threads,
  } = useMailboxThreads(accountIds, query, showUnread, reloadRevision);
  const { toggleRead, trash } = useThreadActions(patchThread);
  const indexProgress = useMailIndexProgress();
  const indexingMessage = getIndexingMessage(indexProgress, accountIds, query);

  // The mailbox stays mounted underneath so its scroll position and virtualiser
  // survive reading a thread without any restoration bookkeeping.
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <MailThreadList
        emptyMessage={getEmptyMessage(query, showUnread)}
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
            threadId={openThread.threadId}
          />
        </div>
      )}
    </div>
  );
};

export const Route = createFileRoute("/")({ component: HomeRoute });
