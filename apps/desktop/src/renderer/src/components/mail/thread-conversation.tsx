import { useState } from "react";

import MailMessageActions from "@/components/mail/message-actions";
import type { MailMessageAction } from "@/components/mail/message-actions";
import MailReplyArea from "@/components/mail/reply-area";
import MailThreadMessage from "@/components/mail/thread-message";
import type { GmailThreadMessage } from "@/shared/ipc/mail";

interface MailThreadConversationProps {
  accountId: string;
  messages: readonly GmailThreadMessage[];
}

const MailThreadConversation = ({
  accountId,
  messages,
}: MailThreadConversationProps) => {
  const [selectedAction, setSelectedAction] =
    useState<MailMessageAction | null>(null);
  const latestMessage = messages.at(-1);

  if (latestMessage === undefined) {
    return (
      <p className="text-muted-foreground py-16 text-center text-sm">
        This conversation has no messages.
      </p>
    );
  }

  return (
    <>
      {messages.map((message) => (
        <MailThreadMessage
          accountId={accountId}
          defaultExpanded={message.id === latestMessage.id}
          fallbackRecipient={accountId}
          key={message.id}
          message={message}
        />
      ))}
      {selectedAction === null ? (
        <MailMessageActions onAction={setSelectedAction} />
      ) : (
        <MailReplyArea
          accountId={accountId}
          action={selectedAction}
          key={`${latestMessage.id}:${selectedAction}`}
          message={latestMessage}
          onCancel={() => setSelectedAction(null)}
        />
      )}
    </>
  );
};

export default MailThreadConversation;
