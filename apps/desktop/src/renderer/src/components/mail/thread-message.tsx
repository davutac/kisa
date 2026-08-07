import { useMemo, useState } from "react";

import MailMessageActions from "@/components/mail/message-actions";
import type { MailMessageAction } from "@/components/mail/message-actions";
import MailMessageAttachments from "@/components/mail/message-attachments";
import MailMessageBody from "@/components/mail/message-body";
import MailMessageHeader from "@/components/mail/message-header";
import MailRemoteImageNotice from "@/components/mail/remote-image-notice";
import { parseMailboxAddress } from "@/mail/address";
import { containsRemoteImages } from "@/mail/remote-images";
import type { GmailThreadMessage } from "@/shared/ipc/mail";
import {
  trustImageSender,
  useIsTrustedImageSender,
} from "@/state/trusted-image-senders";

interface MailThreadMessageProps {
  accountId: string;
  defaultExpanded: boolean;
  fallbackRecipient: string;
  message: GmailThreadMessage;
  onAction: (message: GmailThreadMessage, action: MailMessageAction) => void;
}

const MailThreadMessage = ({
  accountId,
  defaultExpanded,
  fallbackRecipient,
  message,
  onAction,
}: MailThreadMessageProps) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showRemoteImages, setShowRemoteImages] = useState(false);
  const senderEmail = parseMailboxAddress(message.from).email;
  const isTrustedSender = useIsTrustedImageSender(accountId, senderEmail);
  const hasRemoteImages = useMemo(
    () => containsRemoteImages(message.body.html),
    [message.body.html]
  );
  const allowRemoteImages = isTrustedSender || showRemoteImages;

  return (
    <article className="flex flex-col gap-px overflow-hidden">
      <MailMessageHeader
        expanded={expanded}
        fallbackRecipient={fallbackRecipient}
        message={message}
        onToggle={() => setExpanded((current) => !current)}
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
          <MailMessageAttachments attachments={message.attachments} />
          <MailMessageActions
            onAction={(action) => onAction(message, action)}
          />
        </>
      ) : null}
    </article>
  );
};

export default MailThreadMessage;
