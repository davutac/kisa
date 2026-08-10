import { LoaderCircleIcon, SendIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import EmailComposer from "@/components/mail/email-composer";
import type { EmailComposerValue } from "@/components/mail/email-composer";
import EmailRecipientFields from "@/components/mail/email-recipient-fields";
import type { EmailRecipients } from "@/components/mail/email-recipient-fields";
import MailForwardedMessage from "@/components/mail/forwarded-message";
import MailMessageAttachments from "@/components/mail/message-attachments";
import { Button } from "@/components/ui/button";
import { isThreadMailDraftEmpty } from "@/mail/mail-draft";
import { getInitialReplyRecipients } from "@/mail/reply-recipients";
import type { MailMessageAction } from "@/mail/reply-recipients";
import { getMailApi } from "@/platform/desktop";
import type { GmailThreadMessage, MailDraftInput } from "@/shared/ipc/mail";

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
  const mailApi = useMemo(() => getMailApi(), []);
  const [composer, setComposer] = useState<EmailComposerValue>(() => ({
    html: draft.body.html,
    isEmpty: draft.body.text.trim().length === 0,
    text: draft.body.text,
  }));
  const [isSending, setIsSending] = useState(false);
  const [recipients, setRecipients] = useState<EmailRecipients>(() => ({
    bcc: draft.bcc,
    cc: draft.cc,
    to: draft.to,
  }));
  const initialRecipients = useMemo(
    () => getInitialReplyRecipients(accountId, action, message),
    [accountId, action, message]
  );
  const finalizedRef = useRef(false);
  const mountedRef = useRef(false);
  const isForward = action === "forward";
  const canSend = mailApi !== undefined && !isSending;
  const currentDraft = useMemo<MailDraftInput>(
    () => ({
      ...draft,
      bcc: recipients.bcc,
      body: { html: composer.html, text: composer.text },
      cc: recipients.cc,
      to: recipients.to,
    }),
    [composer.html, composer.text, draft, recipients]
  );
  const currentDraftRef = useRef(currentDraft);

  useEffect(() => {
    currentDraftRef.current = currentDraft;
  }, [currentDraft]);

  useEffect(() => {
    if (mailApi === undefined) {
      return;
    }

    const save = async (): Promise<void> => {
      try {
        const reply = await mailApi.saveDraft(currentDraftRef.current);
        if (!reply.ok) {
          toast.error(reply.error);
        }
      } catch {
        toast.error("Could not save draft");
      }
    };
    const timeout = window.setTimeout(() => {
      void save();
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [composer, mailApi, recipients]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      // StrictMode immediately runs setup again; a real unmount does not.
      queueMicrotask(() => {
        if (
          mountedRef.current ||
          finalizedRef.current ||
          mailApi === undefined
        ) {
          return;
        }

        const latest = currentDraftRef.current;
        const settle = async (): Promise<void> => {
          try {
            const reply = isThreadMailDraftEmpty(latest, initialRecipients)
              ? await mailApi.discardDraft({
                  accountId: latest.accountId,
                  draftId: latest.id,
                })
              : await mailApi.saveDraft(latest);
            if (!reply.ok) {
              toast.error(reply.error);
            }
          } catch {
            toast.error("Could not save draft");
          }
        };
        void settle();
      });
    };
  }, [initialRecipients, mailApi]);

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

      finalizedRef.current = true;
      try {
        const discarded = await mailApi.discardDraft({
          accountId,
          draftId: draft.id,
        });
        if (!discarded.ok) {
          toast.error(discarded.error);
        }
      } catch {
        toast.error("Message sent, but its local draft could not be removed");
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

  const discard = async (): Promise<void> => {
    if (mailApi === undefined) {
      return;
    }

    finalizedRef.current = true;
    try {
      const reply = await mailApi.discardDraft({
        accountId,
        draftId: draft.id,
      });
      if (!reply.ok) {
        finalizedRef.current = false;
        toast.error(reply.error);
        return;
      }

      onCancel();
    } catch {
      finalizedRef.current = false;
      toast.error("Could not discard draft");
    }
  };

  return (
    <section
      aria-label={isForward ? "Forward message" : "Reply"}
      className="overflow-hidden"
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
        defaultValue={draft.body.html}
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
          onClick={() => {
            void discard();
          }}
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
