import type { ReactNode } from "react";
import { useCallback, useEffect, useRef } from "react";

import MailMessageActions from "@/components/mail/message-actions";
import MailReplyArea from "@/components/mail/reply-area";
import {
  createThreadConversationStore,
  ThreadConversationStoreProvider,
  useThreadConversationStore,
} from "@/components/mail/thread-conversation-store";
import MailThreadDraftActions from "@/components/mail/thread-draft-actions";
import { getThreadDraftAction } from "@/components/mail/thread-draft-state";
import MailThreadMessage from "@/components/mail/thread-message";
import type { ComposerFocusHandle } from "@/components/mail/use-composer-focus";
import { useThreadDraft } from "@/components/mail/use-thread-draft";
import { useThreadMessageNavigation } from "@/components/mail/use-thread-message-navigation";
import { Accordion } from "@/components/ui/accordion";
import { useInstanceValue } from "@/hooks/use-instance-value";
import { useAppCommand } from "@/hotkeys";
import { getThreadEmailAddresses, parseMailboxAddress } from "@/mail/address";
import { shouldShowReplyAll } from "@/mail/reply-recipients";
import type { ThreadMessage, MailDraftInput } from "@/shared/ipc/mail";

interface MailThreadConversationProps {
  accountId: string;
  messages: readonly ThreadMessage[];
  threadId: string;
}

interface NonEmptyMailThreadConversationProps extends MailThreadConversationProps {
  initialMessageId: string;
  latestMessage: ThreadMessage;
}

// The open message is always the selected one, or none, so a press on any
// header is the store's toggle: it opens and selects another message, or
// opens or closes the selected one. `contents` keeps the messages in the
// conversation's own flex layout.
const MessageAccordion = ({ children }: { readonly children: ReactNode }) => {
  const expandedMessageId = useThreadConversationStore(
    (state) => state.expandedMessageId
  );

  const toggleMessage = useThreadConversationStore(
    (state) => state.toggleMessage
  );

  return (
    <Accordion
      aria-label="Messages"
      className="contents"
      collapsible
      onValueChange={(value) => {
        const messageId = value[0] ?? expandedMessageId;

        if (messageId !== undefined && messageId !== null) {
          toggleMessage(messageId);
        }
      }}
      value={expandedMessageId === null ? [] : [expandedMessageId]}
    >
      {children}
    </Accordion>
  );
};

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
      <MessageAccordion>
        {messages.map((message) => (
          <MailThreadMessage
            accountId={accountId}
            fallbackRecipient={accountId}
            key={message.id}
            message={message}
            onHeaderRef={registerMessageHeader}
          />
        ))}
      </MessageAccordion>
      {conversationFooter}
    </>
  );
};

const NonEmptyMailThreadConversation = ({
  initialMessageId,
  ...props
}: NonEmptyMailThreadConversationProps) => {
  // The parent key changes with the account and thread. New messages must not
  // replace this store and reset an existing selection.
  const store = useInstanceValue(() =>
    createThreadConversationStore(initialMessageId)
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
