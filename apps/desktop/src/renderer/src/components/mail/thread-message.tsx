import { memo, useCallback, useMemo, useState } from "react";

import MailMessageAttachments from "@/components/mail/message-attachments";
import MailMessageBody from "@/components/mail/message-body";
import MailMessageHeader from "@/components/mail/message-header";
import MailRemoteImageNotice from "@/components/mail/remote-image-notice";
import { useThreadConversationStore } from "@/components/mail/thread-conversation-store";
import { parseMailboxAddress } from "@/mail/address";
import { containsRemoteImages } from "@/mail/remote-images";
import type { GmailThreadMessage } from "@/shared/ipc/mail";
import {
  trustImageSender,
  useIsTrustedImageSender,
} from "@/state/trusted-image-senders";

interface MailThreadMessageProps {
  accountId: string;
  fallbackRecipient: string;
  message: GmailThreadMessage;
  onHeaderRef?: (messageId: string, header: HTMLButtonElement | null) => void;
}

const MailThreadMessage = ({
  accountId,
  fallbackRecipient,
  message,
  onHeaderRef,
}: MailThreadMessageProps) => {
  const [showRemoteImages, setShowRemoteImages] = useState(false);
  const expanded = useThreadConversationStore(
    (state) => state.expandedMessageId === message.id
  );
  const selected = useThreadConversationStore(
    (state) => state.selectedMessageId === message.id
  );
  const toggleMessage = useThreadConversationStore(
    (state) => state.toggleMessage
  );
  const senderEmail = parseMailboxAddress(message.from).email;
  const isTrustedSender = useIsTrustedImageSender(accountId, senderEmail);
  const hasRemoteImages = useMemo(
    () => containsRemoteImages(message.body.html),
    [message.body.html]
  );
  const allowRemoteImages = isTrustedSender || showRemoteImages;
  const setHeaderRef = useCallback(
    (header: HTMLButtonElement | null): void => {
      onHeaderRef?.(message.id, header);
    },
    [message.id, onHeaderRef]
  );

  return (
    <article className="flex scroll-mt-20 flex-col gap-px overflow-hidden">
      <MailMessageHeader
        buttonRef={setHeaderRef}
        expanded={expanded}
        fallbackRecipient={fallbackRecipient}
        message={message}
        onToggle={() => toggleMessage(message.id)}
        selected={selected}
      />
      {expanded ? (
        <>
          {/* The notice belongs to the body, so it shares its card instead of
              sitting behind its own separator. */}
          <div className="bg-card flex min-w-0 flex-col">
            {hasRemoteImages && !allowRemoteImages ? (
              <MailRemoteImageNotice
                onAlwaysShow={() => {
                  setShowRemoteImages(true);
                  void trustImageSender(accountId, senderEmail);
                }}
                onShow={() => setShowRemoteImages(true)}
                senderEmail={senderEmail}
              />
            ) : null}
            <MailMessageBody
              allowRemoteImages={allowRemoteImages}
              body={message.body}
              fallbackText={message.snippet}
            />
          </div>
          <MailMessageAttachments
            accountId={accountId}
            attachments={message.attachments}
          />
        </>
      ) : null}
    </article>
  );
};

export default memo(MailThreadMessage);
