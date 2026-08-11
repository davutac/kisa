import { MailOpenIcon } from "lucide-react";
import { useCallback } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { getDeleteSpamConfirmation } from "@/components/mail/delete-spam-confirmation";
import MailThreadConversation from "@/components/mail/thread-conversation";
import MailThreadHeader from "@/components/mail/thread-header";
import ThreadLabels from "@/components/mail/thread-labels";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { hasSpamLabel } from "@/mail/label";
import { useMailThread } from "@/mail/use-mail-thread";
import type {
  ThreadActions,
  ThreadActionTarget,
} from "@/mail/use-thread-actions";
import type { GmailThread } from "@/shared/ipc/mail";

const ThreadPending = () => (
  <Empty aria-live="polite" className="h-full min-h-0 border-0">
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <Spinner />
      </EmptyMedia>
      <EmptyTitle>Untangling the conversation…</EmptyTitle>
    </EmptyHeader>
  </Empty>
);

const ThreadError = ({
  closeLabel,
  message,
  onClose,
}: {
  closeLabel: string;
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
        {closeLabel}
      </Button>
    </EmptyHeader>
  </Empty>
);

interface MailThreadViewProps {
  accountId: string;
  closeLabel?: string;
  onClose: () => void;
  onDeleteSpam: ThreadActions["deleteSpam"];
  onPopOut?: (
    target: Pick<ThreadActionTarget, "accountId" | "threadId">
  ) => Promise<void>;
  onNotSpam: ThreadActions["notSpam"];
  onSetLabel: ThreadActions["setLabel"];
  onToggleRead: ThreadActions["toggleRead"];
  onTrash: ThreadActions["trash"];
  showCloseButton?: boolean;
  threadId: string;
}

interface MailThreadContentProps {
  onClose: () => void;
  onDeleteSpam: ThreadActions["deleteSpam"];
  onNotSpam: ThreadActions["notSpam"];
  onPopOut?: MailThreadViewProps["onPopOut"];
  onSetLabel: ThreadActions["setLabel"];
  onToggleRead: ThreadActions["toggleRead"];
  onTrash: ThreadActions["trash"];
  showCloseButton?: boolean;
  thread: GmailThread;
}

const MailThreadContent = ({
  onClose,
  onDeleteSpam,
  onNotSpam,
  onPopOut,
  onSetLabel,
  onToggleRead,
  onTrash,
  showCloseButton,
  thread,
}: MailThreadContentProps) => {
  const confirm = useConfirm();
  const { accountId, threadId } = thread;
  const isSpam = hasSpamLabel(thread.labels);
  const isUnread = thread.labels.includes("UNREAD");
  const handleToggleRead = useCallback((): void => {
    onToggleRead({
      accountId,
      isUnread,
      threadId,
    } satisfies ThreadActionTarget);
  }, [accountId, isUnread, onToggleRead, threadId]);
  const handleTrash = useCallback((): void => {
    onTrash(
      { accountId, isUnread, threadId } satisfies ThreadActionTarget,
      onClose
    );
  }, [accountId, isUnread, onClose, onTrash, threadId]);
  const requestDeleteSpam = useCallback(async (): Promise<void> => {
    const confirmed = await confirm(getDeleteSpamConfirmation(thread.subject));

    if (confirmed) {
      onDeleteSpam({ accountId, threadId }, onClose);
    }
  }, [accountId, confirm, onClose, onDeleteSpam, thread.subject, threadId]);
  const handleDeleteSpam = useCallback((): void => {
    void requestDeleteSpam();
  }, [requestDeleteSpam]);
  const handleNotSpam = useCallback((): void => {
    onNotSpam({ accountId, threadId }, onClose);
  }, [accountId, onClose, onNotSpam, threadId]);
  const handlePopOut = useCallback((): void => {
    if (onPopOut === undefined) {
      return;
    }

    void onPopOut({ accountId, threadId });
  }, [accountId, onPopOut, threadId]);
  const latestMessage = thread.messages.at(-1);

  return (
    // The header owns the top gutter and the top radius: both belong to the
    // sticky box so its backdrop keeps covering them once messages scroll up
    // behind it.
    <section className="relative flex w-full min-w-0 flex-col gap-px px-4 pb-4 *:last:rounded-b-lg">
      <MailThreadHeader
        isSpam={isSpam}
        isUnread={isUnread}
        latestAt={latestMessage?.sentAt}
        onClose={onClose}
        onDeleteSpam={handleDeleteSpam}
        onNotSpam={handleNotSpam}
        onPopOut={onPopOut === undefined ? undefined : handlePopOut}
        onToggleRead={handleToggleRead}
        onTrash={handleTrash}
        showCloseButton={showCloseButton}
        subject={thread.subject}
      />
      <ThreadLabels
        accountId={accountId}
        labels={thread.labels}
        onSetLabel={onSetLabel}
        threadId={threadId}
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
  closeLabel = "Back to inbox",
  onClose,
  onDeleteSpam,
  onNotSpam,
  onPopOut,
  onSetLabel,
  onToggleRead,
  onTrash,
  showCloseButton,
  threadId,
}: MailThreadViewProps) => {
  const state = useMailThread(accountId, threadId);

  if (state.status === "loading") {
    return <ThreadPending />;
  }

  if (state.status === "error") {
    return (
      <ThreadError
        closeLabel={closeLabel}
        message={state.message}
        onClose={onClose}
      />
    );
  }

  return (
    <MailThreadContent
      onClose={onClose}
      onDeleteSpam={onDeleteSpam}
      onNotSpam={onNotSpam}
      onPopOut={onPopOut}
      onSetLabel={onSetLabel}
      onToggleRead={onToggleRead}
      onTrash={onTrash}
      showCloseButton={showCloseButton}
      thread={state.thread}
    />
  );
};

export default MailThreadView;
