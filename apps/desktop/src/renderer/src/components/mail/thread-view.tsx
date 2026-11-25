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
import { hasStarredLabel } from "@/mail/label";
import {
  canArchiveThread,
  canReportThreadSpam,
  canStarThread,
  hasArchivedMessage,
  hasReceivedMessage,
} from "@/mail/thread-action-availability";
import { useMailThread } from "@/mail/use-mail-thread";
import type {
  ThreadActions,
  ThreadActionTarget,
} from "@/mail/use-thread-actions";
import type { MailThread } from "@/shared/ipc/mail";
import { isListedIn } from "@/shared/mailbox-places";

// A conversation the cache answers for replaces this before its delayed fade
// begins, so a fast open never flashes it.
const ThreadPending = () => (
  <Empty
    aria-live="polite"
    className="h-full min-h-0 border-0 transition-opacity delay-200 duration-150 starting:opacity-0"
  >
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
  /** The conversation's own actions; leaving it is `onClose`. */
  actions: ThreadActions;
  closeLabel?: string;
  onClose: () => void;
  onPopOut?: (
    target: Pick<ThreadActionTarget, "accountId" | "threadId">
  ) => Promise<void>;
  showCloseButton?: boolean;
  threadId: string;
  titlebar?: MailThreadTitlebar;
}

interface MailThreadContentProps {
  actions: ThreadActions;
  onClose: () => void;
  onPopOut?: MailThreadViewProps["onPopOut"];
  showCloseButton?: boolean;
  thread: MailThread;
  titlebar?: MailThreadTitlebar;
}

const MailThreadContent = ({
  actions: threadActions,
  onClose,
  onPopOut,
  showCloseButton,
  thread,
  titlebar: Titlebar,
}: MailThreadContentProps) => {
  const confirm = useConfirm();
  const { setLabel: handleSetLabel } = threadActions;
  const { accountId, threadId } = thread;
  const isSpam = isListedIn(thread.places, "spam");
  const isTrash = isListedIn(thread.places, "trash");
  const isStarred = hasStarredLabel(thread.labels);
  const canDeleteForever = isSpam || isTrash;
  const isUnread = thread.labels.includes("UNREAD");

  const handleToggleRead = useCallback((): void => {
    threadActions.toggleRead({
      accountId,
      isUnread,
      threadId,
    } satisfies ThreadActionTarget);
  }, [accountId, isUnread, threadActions, threadId]);

  const handleTrash = useCallback((): void => {
    threadActions.trash({ accountId, threadId }, onClose);
  }, [accountId, onClose, threadActions, threadId]);

  const requestDeleteForever = useCallback(async (): Promise<void> => {
    const confirmed = await confirm(
      getDeleteForeverConfirmation(thread.subject)
    );

    if (confirmed) {
      threadActions.deleteForever({ accountId, threadId }, onClose);
    }
  }, [accountId, confirm, onClose, thread.subject, threadActions, threadId]);

  const handleDeleteForever = useCallback((): void => {
    void requestDeleteForever();
  }, [requestDeleteForever]);

  const handleNotSpam = useCallback((): void => {
    threadActions.notSpam({ accountId, threadId }, onClose);
  }, [accountId, onClose, threadActions, threadId]);

  const handleArchive = useCallback((): void => {
    threadActions.archive({ accountId, threadId }, onClose);
  }, [accountId, onClose, threadActions, threadId]);

  const handleMoveToInbox = useCallback((): void => {
    threadActions.moveToInbox({ accountId, threadId });
  }, [accountId, threadActions, threadId]);

  const handleToggleStar = useCallback((): void => {
    threadActions.toggleStar({ accountId, isStarred, threadId });
  }, [accountId, isStarred, threadActions, threadId]);

  const handleReportSpam = useCallback((): void => {
    threadActions.reportSpam({ accountId, threadId }, onClose);
  }, [accountId, onClose, threadActions, threadId]);

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

  // Each applies only where it can change something; the commands follow the
  // buttons, so a key never acts on what its button doesn't offer.
  const commands = {
    onArchive: canArchiveThread(thread.places) ? handleArchive : undefined,
    onDeleteForever: onDeleteThreadForever,
    onMoveToInbox: hasArchivedMessage(thread.places, thread.messages)
      ? handleMoveToInbox
      : undefined,
    onPopOut: onPopOutThread,
    onReportSpam:
      canReportThreadSpam(thread.places) && hasReceivedMessage(thread.messages)
        ? handleReportSpam
        : undefined,
    onToggleRead: handleToggleRead,
    onToggleStar: canStarThread(thread.places) ? handleToggleStar : undefined,
    onTrash: onTrashThread,
  };

  const actions = {
    ...commands,
    isSpam,
    isStarred,
    isUnread,
    latestAt: latestMessage?.sentAt,
    onNotSpam: handleNotSpam,
    subject: thread.subject,
  };

  const labels = (
    <ThreadLabels
      accountId={accountId}
      className={Titlebar === undefined ? undefined : "rounded-t-lg"}
      labels={thread.labels}
      onSetLabel={handleSetLabel}
      threadId={threadId}
    />
  );

  return (
    <section className="relative flex w-full min-w-0 flex-col gap-px px-4 pb-4 *:last:rounded-b-lg">
      <MailThreadCommands {...commands} onClose={onClose} />
      {Titlebar === undefined ? (
        <>
          <MailThreadHeader
            {...actions}
            onClose={onClose}
            showCloseButton={showCloseButton}
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
  actions,
  closeLabel = "Back to inbox",
  onClose,
  onPopOut,
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
      actions={actions}
      onClose={onClose}
      onPopOut={onPopOut}
      showCloseButton={showCloseButton}
      thread={state.thread}
      titlebar={Titlebar}
    />
  );
};

export default MailThreadView;
