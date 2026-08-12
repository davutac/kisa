import { LoaderCircleIcon, SendIcon, Trash2Icon } from "lucide-react";
import type { Ref } from "react";

import EmailComposer from "@/components/mail/email-composer";
import EmailRecipientFields from "@/components/mail/email-recipient-fields";
import MailForwardedMessage from "@/components/mail/forwarded-message";
import MailMessageAttachments from "@/components/mail/message-attachments";
import MailRelativeTime from "@/components/mail/relative-time";
import type { ComposerFocusHandle } from "@/components/mail/use-composer-focus";
import { Button } from "@/components/ui/button";
import {
  getHotkeyAriaLabel,
  HotkeyHint,
  useAppCommand,
  useHotkeyLayer,
} from "@/hotkeys";
import { parseMailboxAddress } from "@/mail/address";
import type { MailMessageAction } from "@/mail/reply-recipients";
import type { GmailThreadMessage, MailDraftInput } from "@/shared/ipc/mail";

import { useReplyWorkspace } from "./use-reply-workspace";

interface MailReplyAreaProps {
  accountId: string;
  action: MailMessageAction;
  draft: MailDraftInput;
  message: GmailThreadMessage;
  onCancel: () => void;
  onClose: (draft: MailDraftInput) => void;
  onSent: () => void;
  onComposerReady?: (handle: ComposerFocusHandle | null) => void;
  sectionRef?: Ref<HTMLElement>;
  suggestedAddresses: readonly string[];
  threadId: string;
}

const MailReplyArea = ({
  accountId,
  action,
  draft,
  message,
  onCancel,
  onClose,
  onComposerReady,
  onSent,
  sectionRef,
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
  const handleClose = () => onClose(workspace.currentDraft);
  const sender = parseMailboxAddress(message.from);
  const targetLabel = sender.name ?? sender.email;

  useHotkeyLayer("thread-composer", true);
  useAppCommand("threadComposer.close", handleClose, {
    enabled: !workspace.isSending,
  });
  useAppCommand("threadComposer.send", handleSend, {
    enabled: workspace.canSend,
  });

  return (
    <section
      aria-label={isForward ? "Forward message" : "Reply"}
      className="scroll-mt-20 overflow-hidden"
      ref={sectionRef}
    >
      <div className="bg-card text-muted-foreground flex min-w-0 items-center gap-1.5 px-4 py-2 text-xs">
        <span className="truncate">
          {isForward ? "Forwarding message from" : "Replying to"} {targetLabel}
        </span>
        <span aria-hidden="true">·</span>
        <MailRelativeTime timestamp={message.sentAt} />
      </div>
      <EmailRecipientFields
        accountId={accountId}
        disabled={workspace.isSending}
        onChange={handleRecipientsChange}
        suggestedAddresses={suggestedAddresses}
        value={workspace.recipients}
      />
      <EmailComposer
        ariaLabel="Message"
        className="min-h-48"
        consumeModEnter
        defaultValue={draft.body.html}
        disabled={workspace.isSending}
        focusHandleRef={onComposerReady}
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
          aria-keyshortcuts={getHotkeyAriaLabel("threadComposer.send")}
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
          <HotkeyHint className="ml-2" command="threadComposer.send" />
        </Button>
        <Button
          aria-label="Discard draft"
          className="border-background border-l"
          disabled={workspace.isSending}
          onClick={handleDiscard}
          size="footer-icon"
          title="Discard draft"
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
