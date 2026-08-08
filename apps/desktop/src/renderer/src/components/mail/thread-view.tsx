import { MailOpenIcon } from "lucide-react";
import { useCallback } from "react";

import MailThreadConversation from "@/components/mail/thread-conversation";
import MailThreadHeader from "@/components/mail/thread-header";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { withReadStateLabel } from "@/mail/label";
import { useMailThread } from "@/mail/use-mail-thread";
import { useThreadDetailActions } from "@/mail/use-thread-detail-actions";
import type { GmailThread } from "@/shared/ipc/mail";
import { useMailboxStore } from "@/state/mailbox";

const ThreadPending = () => (
  <Empty aria-live="polite" className="h-full min-h-0 border-0">
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <Spinner />
      </EmptyMedia>
      <EmptyTitle>Loading conversation…</EmptyTitle>
    </EmptyHeader>
  </Empty>
);

const ThreadError = ({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) => (
  <Empty className="min-h-0 flex-1 border-0">
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <MailOpenIcon />
      </EmptyMedia>
      <EmptyTitle>{message}</EmptyTitle>
      <Button onClick={onClose} type="button" variant="outline">
        Back to inbox
      </Button>
    </EmptyHeader>
  </Empty>
);

interface MailThreadViewProps {
  accountId: string;
  onReadStateChanged: (isUnread: boolean) => void;
  onTrashed: () => void;
  threadId: string;
}

interface MailThreadContentProps {
  onReadStateChanged: (isUnread: boolean) => void;
  onTrashed: () => void;
  thread: GmailThread;
}

const MailThreadContent = ({
  onReadStateChanged,
  onTrashed,
  thread,
}: MailThreadContentProps) => {
  const closeThread = useMailboxStore((state) => state.closeThread);
  const handleTrashed = useCallback((): void => {
    onTrashed();
    closeThread();
  }, [closeThread, onTrashed]);
  const { isPending, isUnread, toggleRead, trash } = useThreadDetailActions({
    accountId: thread.accountId,
    initialIsUnread: thread.labels.includes("UNREAD"),
    onReadStateChanged,
    onTrashed: handleTrashed,
    threadId: thread.threadId,
  });
  const latestMessage = thread.messages.at(-1);
  const labels = withReadStateLabel(thread.labels, isUnread);

  return (
    // The header owns the top gutter and the top radius: both belong to the
    // sticky box so its backdrop keeps covering them once messages scroll up
    // behind it.
    <section className="relative flex w-full min-w-0 flex-col gap-px px-4 pb-4 *:last:rounded-b-lg">
      <MailThreadHeader
        accountId={thread.accountId}
        actionsDisabled={isPending}
        isUnread={isUnread}
        labels={labels}
        latestAt={latestMessage?.sentAt}
        onToggleRead={toggleRead}
        onTrash={trash}
        subject={thread.subject}
      />
      <MailThreadConversation
        accountId={thread.accountId}
        messages={thread.messages}
        threadId={thread.threadId}
      />
    </section>
  );
};

const MailThreadView = ({
  accountId,
  onReadStateChanged,
  onTrashed,
  threadId,
}: MailThreadViewProps) => {
  const closeThread = useMailboxStore((state) => state.closeThread);
  const state = useMailThread(accountId, threadId);

  if (state.status === "loading") {
    return <ThreadPending />;
  }

  if (state.status === "error") {
    return <ThreadError message={state.message} onClose={closeThread} />;
  }

  return (
    <MailThreadContent
      onReadStateChanged={onReadStateChanged}
      onTrashed={onTrashed}
      thread={state.thread}
    />
  );
};

export default MailThreadView;
