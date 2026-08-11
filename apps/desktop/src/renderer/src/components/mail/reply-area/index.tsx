import { LoaderCircleIcon, SendIcon, Trash2Icon } from "lucide-react";

import EmailComposer from "@/components/mail/email-composer";
import EmailRecipientFields from "@/components/mail/email-recipient-fields";
import MailForwardedMessage from "@/components/mail/forwarded-message";
import MailMessageAttachments from "@/components/mail/message-attachments";
import { Button } from "@/components/ui/button";
import type { MailMessageAction } from "@/mail/reply-recipients";
import type { GmailThreadMessage, MailDraftInput } from "@/shared/ipc/mail";

import { useReplyWorkspace } from "./use-reply-workspace";

interface MailReplyAreaProps {
  accountId: string;
  action: MailMessageAction;
  draft: MailDraftInput;
  message: GmailThreadMessage;
  onCancel: () => void;
  onSent: () => void;
  suggestedAddresses: readonly string[];
  threadId: string;
}

const MailReplyArea = ({
  accountId,
  action,
  draft,
  message,
  onCancel,
  onSent,
  suggestedAddresses,
  threadId,
}: MailReplyAreaProps) => {
  const workspace = useReplyWorkspace({
    accountId,
    action,
    draft,
    message,
    onCancel,
    onSent,
    threadId,
  });
  const isForward = action === "forward";
  const handleDiscard = workspace.discard;
  const handleComposerChange = workspace.setComposer;
  const handleRecipientsChange = workspace.setRecipients;
  const handleSend = workspace.send;

  return (
    <section
      aria-label={isForward ? "Forward message" : "Reply"}
      className="overflow-hidden"
    >
      <EmailRecipientFields
        accountId={accountId}
        disabled={workspace.isSending}
        onChange={handleRecipientsChange}
        suggestedAddresses={suggestedAddresses}
        value={workspace.recipients}
      />
      <EmailComposer
        ariaLabel="Message"
        autoFocus
        defaultValue={draft.body.html}
        disabled={workspace.isSending}
        onChange={handleComposerChange}
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
      <div className="bg-background flex shrink-0 items-stretch">
        <Button
          disabled={!workspace.canSend}
          onClick={handleSend}
          size="footer"
          type="button"
          variant="secondary"
        >
          {workspace.isSending ? (
            <LoaderCircleIcon
              className="animate-spin"
              data-icon="inline-start"
            />
          ) : (
            <SendIcon data-icon="inline-start" />
          )}
          {workspace.isSending ? "Sending…" : "Send"}
        </Button>
        <Button
          aria-label="Discard reply"
          className="border-background border-l"
          disabled={workspace.isSending}
          onClick={handleDiscard}
          size="footer-icon"
          title="Discard reply"
          type="button"
          variant="secondary"
        >
          <Trash2Icon />
        </Button>
      </div>
    </section>
  );
};

export default MailReplyArea;
