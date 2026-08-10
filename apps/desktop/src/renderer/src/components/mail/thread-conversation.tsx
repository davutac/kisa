import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import MailMessageActions from "@/components/mail/message-actions";
import MailReplyArea from "@/components/mail/reply-area";
import MailThreadMessage from "@/components/mail/thread-message";
import { getThreadEmailAddresses } from "@/mail/address";
import { createThreadMailDraft } from "@/mail/mail-draft";
import { getInitialReplyRecipients } from "@/mail/reply-recipients";
import { getMailApi } from "@/platform/desktop";
import type { GmailThreadMessage, MailDraftInput } from "@/shared/ipc/mail";

interface MailThreadConversationProps {
  accountId: string;
  messages: readonly GmailThreadMessage[];
  threadId: string;
}

const MailThreadConversation = ({
  accountId,
  messages,
  threadId,
}: MailThreadConversationProps) => {
  const mailApi = useMemo(() => getMailApi(), []);
  const [draft, setDraft] = useState<MailDraftInput | null>(null);
  const [isLoadingDraft, setIsLoadingDraft] = useState(mailApi !== undefined);
  const latestMessage = messages.at(-1);
  const draftMessage = messages.find(
    (message) => message.id === draft?.messageId
  );
  const suggestedAddresses = getThreadEmailAddresses(messages, [accountId]);

  useEffect(() => {
    let active = true;

    if (mailApi === undefined) {
      return;
    }

    const load = async (): Promise<void> => {
      try {
        const reply = await mailApi.loadThreadDraft({ accountId, threadId });
        if (!active) {
          return;
        }

        if (!reply.ok) {
          toast.error(reply.error);
          return;
        }

        setDraft(reply.data);
      } catch {
        if (active) {
          toast.error("Could not load saved reply");
        }
      } finally {
        if (active) {
          setIsLoadingDraft(false);
        }
      }
    };
    void load();

    const unsubscribe = mailApi.onDraftChanged((change) => {
      if (change.kind === "remove") {
        if (change.accountId === accountId && change.threadId === threadId) {
          setDraft((current) =>
            current?.id === change.draftId ? null : current
          );
        }
        return;
      }

      if (
        change.draft.accountId === accountId &&
        change.draft.threadId === threadId
      ) {
        setDraft((current) => current ?? change.draft);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [accountId, mailApi, threadId]);

  const createDraft = async (created: MailDraftInput): Promise<void> => {
    setDraft(created);
    if (mailApi === undefined) {
      return;
    }

    try {
      const reply = await mailApi.saveDraft(created);
      if (!reply.ok) {
        toast.error(reply.error);
      }
    } catch {
      toast.error("Could not save draft");
    }
  };

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
      {draft === null ? (
        <MailMessageActions
          disabled={isLoadingDraft}
          onAction={(action) => {
            const created = createThreadMailDraft({
              accountId,
              action,
              messageId: latestMessage.id,
              recipients: getInitialReplyRecipients(
                accountId,
                action,
                latestMessage
              ),
              threadId,
            });

            void createDraft(created);
          }}
        />
      ) : (
        <MailReplyArea
          accountId={accountId}
          action={draft.kind === "new" ? "reply" : draft.kind}
          draft={draft}
          key={draft.id}
          message={draftMessage ?? latestMessage}
          onCancel={() => setDraft(null)}
          onSent={() => setDraft(null)}
          suggestedAddresses={suggestedAddresses}
          threadId={threadId}
        />
      )}
    </>
  );
};

export default MailThreadConversation;
