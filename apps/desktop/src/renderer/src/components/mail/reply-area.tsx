import { SendIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import EmailComposer from "@/components/mail/email-composer";
import EmailRecipientFields from "@/components/mail/email-recipient-fields";
import type { EmailRecipients } from "@/components/mail/email-recipient-fields";
import MailForwardedMessage from "@/components/mail/forwarded-message";
import MailMessageAttachments from "@/components/mail/message-attachments";
import { Button } from "@/components/ui/button";
import { getInitialReplyRecipients } from "@/mail/reply-recipients";
import type { MailMessageAction } from "@/mail/reply-recipients";
import type { GmailThreadMessage } from "@/shared/ipc/mail";

interface MailReplyAreaProps {
  accountId: string;
  action: MailMessageAction;
  message: GmailThreadMessage;
  onCancel: () => void;
}

const MailReplyArea = ({
  accountId,
  action,
  message,
  onCancel,
}: MailReplyAreaProps) => {
  const [recipients, setRecipients] = useState<EmailRecipients>(() =>
    getInitialReplyRecipients(accountId, action, message)
  );
  const isForward = action === "forward";

  return (
    <section
      className="overflow-hidden"
      aria-label={isForward ? "Forward message" : "Reply"}
    >
      <EmailRecipientFields onChange={setRecipients} value={recipients} />
      <EmailComposer
        ariaLabel="Message"
        autoFocus
        placeholder={isForward ? "Add a message" : "Write a reply"}
      />
      {isForward ? (
        <>
          <MailForwardedMessage message={message} />
          <MailMessageAttachments attachments={message.attachments} />
        </>
      ) : null}
      <div className="bg-card flex items-center gap-2 p-4">
        <Button disabled title="Sending replies is not available yet">
          <SendIcon data-icon="inline-start" />
          Send
        </Button>
        <span className="text-muted-foreground text-xs">
          Sending will be enabled when reply transport is available.
        </span>
        <Button
          aria-label="Discard reply"
          className="ml-auto"
          onClick={onCancel}
          size="icon"
          title="Discard reply"
          type="button"
          variant="ghost"
        >
          <Trash2Icon />
        </Button>
      </div>
    </section>
  );
};

export default MailReplyArea;
