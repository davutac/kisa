import { useState } from "react";

import type { MailMessageAction } from "@/components/mail/message-actions";
import MailReplyArea from "@/components/mail/reply-area";
import MailThreadMessage from "@/components/mail/thread-message";
import type { GmailThreadMessage } from "@/shared/ipc/mail";

interface MailThreadConversationProps {
  accountId: string;
  messages: readonly GmailThreadMessage[];
}

interface ReplySelection {
  action: MailMessageAction;
  message: GmailThreadMessage;
}

const MailThreadConversation = ({
  accountId,
  messages,
}: MailThreadConversationProps) => {
  const [replySelection, setReplySelection] = useState<ReplySelection | null>(
    null
  );
  const latestMessage = messages.at(-1);

  if (latestMessage === undefined) {
    return (
      <p className="text-muted-foreground py-16 text-center text-sm">
        This conversation has no messages.
      </p>
    );
  }

  const replyMessage = replySelection?.message ?? latestMessage;

  return (
    <>
      {messages.map((message) => (
        <MailThreadMessage
          accountId={accountId}
          defaultExpanded={message.id === latestMessage.id}
          fallbackRecipient={accountId}
          key={message.id}
          message={message}
          onAction={(selectedMessage, action) =>
            setReplySelection({ action, message: selectedMessage })
          }
        />
      ))}
      <MailReplyArea
        accountId={accountId}
        action={replySelection?.action}
        key={`${replyMessage.id}:${replySelection?.action ?? "closed"}`}
        message={replyMessage}
        onCancel={() => setReplySelection(null)}
        onStartReply={() =>
          setReplySelection({ action: "reply", message: latestMessage })
        }
      />
    </>
  );
};

export default MailThreadConversation;
