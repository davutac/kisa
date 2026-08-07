import { ReplyIcon, SendIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import EmailComposer from "@/components/mail/email-composer";
import EmailRecipientFields from "@/components/mail/email-recipient-fields";
import type { EmailRecipients } from "@/components/mail/email-recipient-fields";
import type { MailMessageAction } from "@/components/mail/message-actions";
import { Button } from "@/components/ui/button";
import { extractEmailAddresses, parseMailboxAddress } from "@/mail/address";
import type { GmailThreadMessage } from "@/shared/ipc/mail";

interface MailReplyAreaProps {
  accountId: string;
  action?: MailMessageAction;
  message: GmailThreadMessage;
  onCancel: () => void;
  onStartReply: () => void;
}

const getAddresses = (header?: string): readonly string[] => {
  if (header === undefined) {
    return [];
  }

  const addresses = extractEmailAddresses(header);
  return addresses.length > 0 ? addresses : [parseMailboxAddress(header).email];
};

const uniqueAddresses = (
  addresses: readonly string[],
  excludedAddresses: readonly string[] = []
): readonly string[] => {
  const excluded = new Set(
    excludedAddresses.map((address) => address.toLowerCase())
  );
  const seen = new Set<string>();

  return addresses.filter((address) => {
    const normalizedAddress = address.toLowerCase();

    if (excluded.has(normalizedAddress) || seen.has(normalizedAddress)) {
      return false;
    }

    seen.add(normalizedAddress);
    return true;
  });
};

const getInitialRecipients = (
  accountId: string,
  action: MailMessageAction,
  message: GmailThreadMessage
): EmailRecipients => {
  if (action === "forward") {
    return { bcc: [], cc: [], to: [] };
  }

  const senderAddresses = uniqueAddresses(
    getAddresses(message.replyTo ?? message.from),
    [accountId]
  );
  const fallbackAddresses = uniqueAddresses(getAddresses(message.to), [
    accountId,
  ]);
  const toAddresses =
    senderAddresses.length > 0 ? senderAddresses : fallbackAddresses;

  if (action === "reply") {
    return { bcc: [], cc: [], to: toAddresses };
  }

  const originalToAddresses = uniqueAddresses(getAddresses(message.to), [
    accountId,
    ...toAddresses,
  ]);
  const replyAllToAddresses = [...toAddresses, ...originalToAddresses];
  const ccAddresses = uniqueAddresses(getAddresses(message.cc), [
    accountId,
    ...replyAllToAddresses,
  ]);

  return {
    bcc: [],
    cc: ccAddresses,
    to: replyAllToAddresses,
  };
};

const MailReplyArea = ({
  accountId,
  action,
  message,
  onCancel,
  onStartReply,
}: MailReplyAreaProps) => {
  const [recipients, setRecipients] = useState<EmailRecipients>(() =>
    action === undefined
      ? { bcc: [], cc: [], to: [] }
      : getInitialRecipients(accountId, action, message)
  );

  if (action === undefined) {
    return (
      <div className="bg-card p-4">
        <Button onClick={onStartReply} variant="outline">
          <ReplyIcon data-icon="inline-start" />
          Reply
        </Button>
      </div>
    );
  }

  return (
    <section
      className="overflow-hidden"
      aria-label={action === "forward" ? "Forward message" : "Reply"}
    >
      <EmailRecipientFields onChange={setRecipients} value={recipients} />
      <EmailComposer
        ariaLabel="Message"
        autoFocus
        placeholder={action === "forward" ? "Add a message" : "Write a reply"}
      />
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
          size="icon-sm"
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
