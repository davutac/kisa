import { MailOpenIcon } from "lucide-react";
import { useCallback } from "react";
import type { ComponentType, ReactNode } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { getDeleteForeverConfirmation } from "@/components/mail/delete-forever-confirmation";
import MailThreadConversation from "@/components/mail/thread-conversation";
import MailThreadHeader, {
  MailThreadActions,
  MailThreadCommands,
} from "@/components/mail/thread-header";
import ThreadLabels from "@/components/mail/thread-labels";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { hasSpamLabel, hasTrashLabel } from "@/mail/label";
import { useMailThread } from "@/mail/use-mail-thread";
import type {
  ThreadActions,
  ThreadActionTarget,
} from "@/mail/use-thread-actions";
import type { MailThread } from "@/shared/ipc/mail";

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

/**
 * Fills the main window's content titlebar for an open conversation: its
 * subject once loaded, and its actions. Without it, as in a pop-out window,
 * the conversation keeps both in its own header card.
 */
export interface MailThreadTitlebarProps {
  readonly actions?: ReactNode;
  /** Absent while the conversation loads or failed to. */
  readonly subject?: string;
}

export type MailThreadTitlebar = ComponentType<MailThreadTitlebarProps>;

interface MailThreadViewProps {
  accountId: string;
  closeLabel?: string;
  onClose: () => void;
  onDeleteForever: ThreadActions["deleteForever"];
  onPopOut?: (
    target: Pick<ThreadActionTarget, "accountId" | "threadId">
  ) => Promise<void>;
  onNotSpam: ThreadActions["notSpam"];
  onSetLabel: ThreadActions["setLabel"];
  onToggleRead: ThreadActions["toggleRead"];
  onTrash: ThreadActions["trash"];
  showCloseButton?: boolean;
  threadId: string;
  titlebar?: MailThreadTitlebar;
}

interface MailThreadContentProps {
  onClose: () => void;
  onDeleteForever: ThreadActions["deleteForever"];
  onNotSpam: ThreadActions["notSpam"];
  onPopOut?: MailThreadViewProps["onPopOut"];
  onSetLabel: ThreadActions["setLabel"];
  onToggleRead: ThreadActions["toggleRead"];
  onTrash: ThreadActions["trash"];
  showCloseButton?: boolean;
  thread: MailThread;
  titlebar?: MailThreadTitlebar;
}

const MailThreadContent = ({
  onClose,
  onDeleteForever,
  onNotSpam,
  onPopOut,
  onSetLabel,
  onToggleRead,
  onTrash,
  showCloseButton,
  thread,
  titlebar: Titlebar,
}: MailThreadContentProps) => {
  const confirm = useConfirm();
  const { accountId, threadId } = thread;
  const isSpam = hasSpamLabel(thread.labels);
  const isTrash = hasTrashLabel(thread.labels);
  const canDeleteForever = isSpam || isTrash;
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
  const requestDeleteForever = useCallback(async (): Promise<void> => {
    const confirmed = await confirm(
      getDeleteForeverConfirmation(thread.subject)
    );

    if (confirmed) {
      onDeleteForever({ accountId, threadId }, onClose);
    }
  }, [accountId, confirm, onClose, onDeleteForever, thread.subject, threadId]);
  const handleDeleteForever = useCallback((): void => {
    void requestDeleteForever();
  }, [requestDeleteForever]);
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
  const onDeleteThreadForever = canDeleteForever
    ? handleDeleteForever
    : undefined;
  const onTrashThread = canDeleteForever ? undefined : handleTrash;
  const onPopOutThread = onPopOut === undefined ? undefined : handlePopOut;
  const actions = {
    isSpam,
    isUnread,
    latestAt: latestMessage?.sentAt,
    onDeleteForever: onDeleteThreadForever,
    onNotSpam: handleNotSpam,
    onPopOut: onPopOutThread,
    onToggleRead: handleToggleRead,
    onTrash: onTrashThread,
  };
  const labels = (
    <ThreadLabels
      accountId={accountId}
      className={Titlebar === undefined ? undefined : "rounded-t-lg"}
      labels={thread.labels}
      onSetLabel={onSetLabel}
      threadId={threadId}
    />
  );

  return (
    <section className="relative flex w-full min-w-0 flex-col gap-px px-4 pb-4 *:last:rounded-b-lg">
      <MailThreadCommands
        onClose={onClose}
        onDeleteForever={onDeleteThreadForever}
        onPopOut={onPopOutThread}
        onToggleRead={handleToggleRead}
        onTrash={onTrashThread}
      />
      {Titlebar === undefined ? (
        <>
          <MailThreadHeader
            {...actions}
            onClose={onClose}
            showCloseButton={showCloseButton}
            subject={thread.subject}
          />
          {labels}
        </>
      ) : (
        <>
          <Titlebar
            actions={<MailThreadActions {...actions} />}
            subject={thread.subject}
          />
          {/* With the subject and actions in the titlebar, the labels lead
              the conversation and stick to the top as it scrolls. The
              opaque gutter and 1px strip below keep messages from showing
              through the card's corners and the flex gap behind it. */}
          <div className="bg-background after:bg-background sticky top-0 z-10 pt-1 after:absolute after:inset-x-0 after:top-full after:h-px">
            {labels}
          </div>
        </>
      )}
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
  onDeleteForever,
  onNotSpam,
  onPopOut,
  onSetLabel,
  onToggleRead,
  onTrash,
  showCloseButton,
  threadId,
  titlebar: Titlebar,
}: MailThreadViewProps) => {
  const state = useMailThread(accountId, threadId);

  if (state.status === "loading") {
    return (
      <>
        {Titlebar === undefined ? null : <Titlebar />}
        <ThreadPending />
      </>
    );
  }

  if (state.status === "error") {
    return (
      <>
        {Titlebar === undefined ? null : <Titlebar />}
        <ThreadError
          closeLabel={closeLabel}
          message={state.message}
          onClose={onClose}
        />
      </>
    );
  }

  return (
    <MailThreadContent
      onClose={onClose}
      onDeleteForever={onDeleteForever}
      onNotSpam={onNotSpam}
      onPopOut={onPopOut}
      onSetLabel={onSetLabel}
      onToggleRead={onToggleRead}
      onTrash={onTrash}
      showCloseButton={showCloseButton}
      thread={state.thread}
      titlebar={Titlebar}
    />
  );
};

export default MailThreadView;
