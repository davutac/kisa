import { LoaderCircleIcon, SendIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import EmailComposer from "@/components/mail/email-composer";
import type { EmailComposerValue } from "@/components/mail/email-composer";
import EmailRecipientFields from "@/components/mail/email-recipient-fields";
import type { EmailRecipients } from "@/components/mail/email-recipient-fields";
import MailForwardedMessage from "@/components/mail/forwarded-message";
import MailMessageAttachments from "@/components/mail/message-attachments";
import { Button } from "@/components/ui/button";
import { getInitialReplyRecipients } from "@/mail/reply-recipients";
import type { MailMessageAction } from "@/mail/reply-recipients";
import { getMailApi } from "@/platform/desktop";
import type { GmailThreadMessage } from "@/shared/ipc/mail";

interface MailReplyAreaProps {
  accountId: string;
  action: MailMessageAction;
  message: GmailThreadMessage;
  onCancel: () => void;
  onSent: () => void;
  suggestedAddresses: readonly string[];
  threadId: string;
}

const EMPTY_COMPOSER_VALUE: EmailComposerValue = {
  html: "",
  isEmpty: true,
  text: "",
};

const MailReplyArea = ({
  accountId,
  action,
  message,
  onCancel,
  onSent,
  suggestedAddresses,
  threadId,
}: MailReplyAreaProps) => {
  const mailApi = useMemo(() => getMailApi(), []);
  const [composer, setComposer] = useState(EMPTY_COMPOSER_VALUE);
  const [isSending, setIsSending] = useState(false);
  const [recipients, setRecipients] = useState<EmailRecipients>(() =>
    getInitialReplyRecipients(accountId, action, message)
  );
  const isForward = action === "forward";
  const canSend = mailApi !== undefined && !isSending;

  const send = async (): Promise<void> => {
    if (!canSend) {
      return;
    }

    setIsSending(true);

    try {
      const reply = await mailApi.sendThreadMessage({
        accountId,
        action,
        bcc: recipients.bcc,
        body: { html: composer.html, text: composer.text },
        cc: recipients.cc,
        messageId: message.id,
        threadId,
        to: recipients.to,
      });

      if (!reply.ok) {
        toast.error(reply.error);
        return;
      }

      toast.success("Message sent");
      onSent();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not send message"
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <section
      className="overflow-hidden"
      aria-label={isForward ? "Forward message" : "Reply"}
    >
      <EmailRecipientFields
        accountId={accountId}
        disabled={isSending}
        onChange={setRecipients}
        suggestedAddresses={suggestedAddresses}
        value={recipients}
      />
      <EmailComposer
        ariaLabel="Message"
        autoFocus
        disabled={isSending}
        onChange={setComposer}
        placeholder={isForward ? "Add a message" : "Write a reply"}
      />
      {isForward ? (
        <>
          <MailForwardedMessage message={message} />
          <MailMessageAttachments
            accountId={accountId}
            attachments={message.attachments}
          />
        </>
      ) : null}
      <div className="bg-card flex items-center gap-2 p-4">
        <Button
          disabled={!canSend}
          onClick={() => {
            void send();
          }}
          type="button"
        >
          {isSending ? (
            <LoaderCircleIcon
              className="animate-spin"
              data-icon="inline-start"
            />
          ) : (
            <SendIcon data-icon="inline-start" />
          )}
          {isSending ? "Sending…" : "Send"}
        </Button>
        <Button
          aria-label="Discard reply"
          className="ml-auto"
          disabled={isSending}
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
