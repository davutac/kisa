// The scoped store intentionally lives for one keyed conversation instance.
// oxlint-disable react/react-compiler
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import MailMessageActions from "@/components/mail/message-actions";
import MailReplyArea from "@/components/mail/reply-area";
import {
  createThreadConversationStore,
  ThreadConversationStoreProvider,
} from "@/components/mail/thread-conversation-store";
import MailThreadDraftActions from "@/components/mail/thread-draft-actions";
import MailThreadMessage from "@/components/mail/thread-message";
import type { ComposerFocusHandle } from "@/components/mail/use-composer-focus";
import {
  getThreadDraftAction,
  useThreadDraft,
} from "@/components/mail/use-thread-draft";
import { useThreadMessageNavigation } from "@/components/mail/use-thread-message-navigation";
import { useAppCommand } from "@/hotkeys";
import { getThreadEmailAddresses, parseMailboxAddress } from "@/mail/address";
import { shouldShowReplyAll } from "@/mail/reply-recipients";
import type { GmailThreadMessage, MailDraftInput } from "@/shared/ipc/mail";

interface MailThreadConversationProps {
  accountId: string;
  messages: readonly GmailThreadMessage[];
  threadId: string;
}

interface NonEmptyMailThreadConversationProps extends MailThreadConversationProps {
  initialMessageId: string;
  latestMessage: GmailThreadMessage;
}

const MailThreadConversationContent = ({
  accountId,
  latestMessage,
  messages,
  threadId,
}: Omit<NonEmptyMailThreadConversationProps, "initialMessageId">) => {
  const replyComposerFocusRef = useRef<ComposerFocusHandle | null>(null);
  const replyAreaRef = useRef<HTMLElement>(null);
  const { focusSelectedMessage, registerMessageHeader, selectedMessageId } =
    useThreadMessageNavigation(messages);
  const selectedMessage =
    messages.find((message) => message.id === selectedMessageId) ??
    latestMessage;
  const isReplyAllAvailable = shouldShowReplyAll(accountId, selectedMessage);
  const {
    clearDraft,
    closeComposer: closeDraftComposer,
    continueDraft,
    discardDraft,
    draft,
    draftMessage,
    isComposerOpen,
    isDiscardingDraft,
    isLoadingDraft,
    startAction,
  } = useThreadDraft({
    accountId,
    messages,
    selectedMessage,
    threadId,
  });
  const suggestedAddresses = getThreadEmailAddresses(messages, [accountId]);

  useEffect(() => {
    if (!isComposerOpen) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      const replyArea = replyAreaRef.current;
      if (replyArea !== null) {
        replyArea.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      replyComposerFocusRef.current?.focus();
    });

    return () => cancelAnimationFrame(frame);
  }, [isComposerOpen]);

  const closeComposer = useCallback(
    (currentDraft: MailDraftInput): void => {
      closeDraftComposer(currentDraft);
      focusSelectedMessage();
    },
    [closeDraftComposer, focusSelectedMessage]
  );
  useAppCommand(
    "thread.replyToMessage",
    () => {
      startAction("reply");
    },
    { enabled: !isLoadingDraft }
  );
  useAppCommand(
    "thread.replyAllToMessage",
    () => {
      startAction("reply-all");
    },
    { enabled: isReplyAllAvailable && !isLoadingDraft }
  );
  useAppCommand(
    "thread.forwardMessage",
    () => {
      startAction("forward");
    },
    { enabled: !isLoadingDraft }
  );

  const selectedSender = parseMailboxAddress(selectedMessage.from);
  const selectedTargetLabel = selectedSender.name ?? selectedSender.email;
  let conversationFooter: ReactNode;

  if (draft === null) {
    conversationFooter = (
      <MailMessageActions
        disabled={isLoadingDraft}
        onAction={startAction}
        showReplyAll={isReplyAllAvailable}
        targetLabel={selectedTargetLabel}
      />
    );
  } else if (isComposerOpen && draftMessage !== undefined) {
    conversationFooter = (
      <MailReplyArea
        accountId={accountId}
        action={getThreadDraftAction(draft)}
        draft={draft}
        key={draft.id}
        message={draftMessage}
        onCancel={clearDraft}
        onClose={closeComposer}
        onComposerReady={(handle) => {
          replyComposerFocusRef.current = handle;
        }}
        onSent={clearDraft}
        sectionRef={replyAreaRef}
        suggestedAddresses={suggestedAddresses}
        threadId={threadId}
      />
    );
  } else {
    conversationFooter = (
      <MailThreadDraftActions
        action={getThreadDraftAction(draft)}
        disabled={isDiscardingDraft}
        onContinue={continueDraft}
        onDiscard={() => {
          void discardDraft();
        }}
        targetAvailable={draftMessage !== undefined}
      />
    );
  }

  return (
    <>
      {messages.map((message) => (
        <MailThreadMessage
          accountId={accountId}
          fallbackRecipient={accountId}
          key={message.id}
          message={message}
          onHeaderRef={registerMessageHeader}
        />
      ))}
      {conversationFooter}
    </>
  );
};

const NonEmptyMailThreadConversation = ({
  initialMessageId,
  ...props
}: NonEmptyMailThreadConversationProps) => {
  const store = useMemo(
    () => createThreadConversationStore(initialMessageId),
    // The parent key changes with the account and thread. New messages must not
    // replace this store and reset an existing selection.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <ThreadConversationStoreProvider store={store}>
      <MailThreadConversationContent {...props} />
    </ThreadConversationStoreProvider>
  );
};

const MailThreadConversation = (props: MailThreadConversationProps) => {
  const latestMessage = props.messages.at(-1);

  if (latestMessage === undefined) {
    return (
      <p className="text-muted-foreground py-16 text-center text-sm">
        This conversation has no messages.
      </p>
    );
  }

  return (
    <NonEmptyMailThreadConversation
      {...props}
      initialMessageId={latestMessage.id}
      key={`${props.accountId}:${props.threadId}`}
      latestMessage={latestMessage}
    />
  );
};

export default MailThreadConversation;
