import { memo, useCallback, useMemo, useState } from "react";

import MailMessageAttachments from "@/components/mail/message-attachments";
import MailMessageBody from "@/components/mail/message-body";
import MailMessageHeader from "@/components/mail/message-header";
import MailMessageQuotes from "@/components/mail/message-quotes";
import MailRemoteImageNotice from "@/components/mail/remote-image-notice";
import { useThreadConversationStore } from "@/components/mail/thread-conversation-store";
import { AccordionItem, AccordionPanel } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import { parseMailboxAddress } from "@/mail/address";
import {
  matchQuotedMessages,
  splitQuotedMessages,
} from "@/mail/quoted-messages";
import { containsRemoteImages } from "@/mail/remote-images";
import type { ThreadMessage } from "@/shared/ipc/mail";
import { canApplySenderTrust } from "@/shared/sender-trust";
import {
  trustImageSender,
  useIsTrustedImageSender,
} from "@/state/trusted-image-senders";

interface MailThreadMessageProps {
  accountId: string;
  fallbackRecipient: string;
  /** The conversation's messages, oldest first, this one among them. */
  conversation: readonly ThreadMessage[];
  /**
   * Whether the earlier messages this one quotes at its end are set apart
   * from it. Not for the first message, whose quotes nothing above it
   * shows, nor for a forward.
   */
  foldsQuotedText: boolean;
  message: ThreadMessage;
  onShowMessage: (messageId: string) => void;
  onHeaderRef?: (messageId: string, header: HTMLButtonElement | null) => void;
}

const MailThreadMessage = ({
  accountId,
  conversation,
  fallbackRecipient,
  foldsQuotedText,
  message,
  onHeaderRef,
  onShowMessage,
}: MailThreadMessageProps) => {
  const [showRemoteImages, setShowRemoteImages] = useState(false);

  const expanded = useThreadConversationStore((state) =>
    state.expandedMessageIds.has(message.id)
  );

  const selected = useThreadConversationStore(
    (state) => state.selectedMessageId === message.id
  );

  const selectMessage = useThreadConversationStore(
    (state) => state.selectMessage
  );

  const selectThisMessage = useCallback((): void => {
    selectMessage(message.id);
  }, [message.id, selectMessage]);

  const senderEmail = parseMailboxAddress(message.from).email;
  const canTrustSender = canApplySenderTrust(message);
  const isTrustedSender = useIsTrustedImageSender(accountId, senderEmail);

  const hasRemoteImages = useMemo(
    () => containsRemoteImages(message.body.html),
    [message.body.html]
  );

  const allowRemoteImages =
    (canTrustSender && isTrustedSender) || showRemoteImages;

  // A closed message shows no body, so only an open one is read for quotes.
  // Keyed on the body's text, as a refreshed message is a new object.
  const { html: bodyHtml, text: bodyText } = message.body;

  const split = useMemo(
    () =>
      expanded && foldsQuotedText
        ? splitQuotedMessages(bodyHtml, bodyText)
        : null,
    [bodyHtml, bodyText, expanded, foldsQuotedText]
  );

  const quoteMatches = useMemo(() => {
    const index = conversation.findIndex(({ id }) => id === message.id);

    return split === null || index === -1
      ? []
      : matchQuotedMessages(split.quotes, conversation.slice(0, index));
  }, [conversation, message.id, split]);

  const setHeaderRef = useCallback(
    (header: HTMLButtonElement | null): void => {
      onHeaderRef?.(message.id, header);
    },
    [message.id, onHeaderRef]
  );

  return (
    <AccordionItem
      // A bar down the selected message's edge, through its header and body,
      // marks the reply and forward target among several open messages. A
      // conversation of one message has nothing to tell apart. `isolate`
      // keeps the bar under the conversation's sticky subject.
      className={cn(
        "relative isolate flex scroll-mt-20 flex-col gap-px overflow-hidden",
        "before:bg-primary before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:z-10 before:w-0.5 before:opacity-0 before:transition-opacity",
        selected && "not-only-of-type:before:opacity-100"
      )}
      render={<article />}
      value={message.id}
    >
      <MailMessageHeader
        buttonRef={setHeaderRef}
        expanded={expanded}
        fallbackRecipient={fallbackRecipient}
        message={message}
        selected={selected}
      />
      {/* A press anywhere in an open message selects it, as its header does,
          without opening or closing it. */}
      <AccordionPanel
        className="flex flex-col gap-px"
        onPointerDownCapture={selectThisMessage}
      >
        {/* The notice belongs to the body, so it shares its card instead of
            sitting behind its own separator. */}
        <div className="bg-card flex min-w-0 flex-col">
          {hasRemoteImages && !allowRemoteImages ? (
            <MailRemoteImageNotice
              onAlwaysShow={
                canTrustSender
                  ? () => {
                      setShowRemoteImages(true);
                      void trustImageSender(accountId, senderEmail);
                    }
                  : undefined
              }
              onShow={() => setShowRemoteImages(true)}
              senderEmail={senderEmail}
            />
          ) : null}
          <MailMessageBody
            allowRemoteImages={allowRemoteImages}
            body={split?.reply ?? message.body}
            copyText={split?.copyText}
            fallbackText={message.snippet}
            onFramePointerDown={selectThisMessage}
          />
          {split === null || split.quotes.length === 0 ? null : (
            <MailMessageQuotes
              allowRemoteImages={allowRemoteImages}
              matches={quoteMatches}
              onFramePointerDown={selectThisMessage}
              onShowMessage={onShowMessage}
              quotes={split.quotes}
            />
          )}
        </div>
        <MailMessageAttachments
          accountId={accountId}
          attachments={message.attachments}
        />
      </AccordionPanel>
    </AccordionItem>
  );
};

export default memo(MailThreadMessage);
