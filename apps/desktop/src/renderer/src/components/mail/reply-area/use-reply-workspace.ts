import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { EmailComposerValue } from "@/components/mail/email-composer";
import type { EmailRecipients } from "@/components/mail/email-recipient-fields";
import { useAiModelSelection } from "@/hooks/use-ai-model-selection";
import { isThreadMailDraftEmpty } from "@/mail/mail-draft";
import { getInitialReplyRecipients } from "@/mail/reply-recipients";
import type { MailMessageAction } from "@/mail/reply-recipients";
import { getAiApi, getMailApi } from "@/platform/desktop";
import type { GmailThreadMessage, MailDraftInput } from "@/shared/ipc/mail";

export const useReplyWorkspace = ({
  accountId,
  action,
  draft,
  message,
  onCancel,
  onSent,
  replaceComposerContent,
  threadId,
}: {
  accountId: string;
  action: MailMessageAction;
  draft: MailDraftInput;
  message: GmailThreadMessage;
  onCancel: () => void;
  onSent: () => void;
  replaceComposerContent: (content: string) => boolean;
  threadId: string;
}) => {
  const aiApi = useMemo(() => getAiApi(), []);
  const aiModel = useAiModelSelection();
  const mailApi = useMemo(() => getMailApi(), []);
  const [composer, setComposer] = useState<EmailComposerValue>(() => ({
    html: draft.body.html,
    isEmpty: draft.body.text.trim().length === 0,
    text: draft.body.text,
  }));
  const [aiAction, setAiAction] = useState<"clean" | "create" | null>(null);
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
  const isBusy = aiAction !== null || isSending;
  const canClean = aiModel.selection !== null && !composer.isEmpty && !isBusy;
  const canCreateReply =
    aiModel.selection !== null &&
    action !== "forward" &&
    composer.isEmpty &&
    !isBusy;

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
    const timeout = window.setTimeout(save, 450);
    return () => window.clearTimeout(timeout);
  }, [composer, mailApi, recipients]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
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
    if (mailApi === undefined || isBusy) {
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
    if (mailApi === undefined || isBusy) {
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

  const applyGeneratedBody = (body: string, successMessage: string): void => {
    if (!replaceComposerContent(body)) {
      toast.error("Could not update the reply draft");
      return;
    }
    toast.success(successMessage);
  };

  const clean = async (): Promise<void> => {
    if (!(aiApi && aiModel.selection && canClean)) {
      return;
    }
    setAiAction("clean");
    try {
      const reply = await aiApi.cleanupDraft({
        body: composer.html,
        model: aiModel.selection,
        subject: draft.subject,
      });
      if (!mountedRef.current) {
        return;
      }
      if (!reply.ok) {
        toast.error(reply.error);
        return;
      }
      applyGeneratedBody(reply.data.body, "Reply cleaned up");
    } catch (error) {
      if (mountedRef.current) {
        toast.error(
          error instanceof Error ? error.message : "Could not clean up reply"
        );
      }
    } finally {
      if (mountedRef.current) {
        setAiAction(null);
      }
    }
  };

  const createReply = async (): Promise<void> => {
    if (!(aiApi && aiModel.selection && canCreateReply)) {
      return;
    }
    setAiAction("create");
    try {
      const reply = await aiApi.generateReply({
        accountId,
        model: aiModel.selection,
        threadId,
      });
      if (!mountedRef.current) {
        return;
      }
      if (!reply.ok) {
        toast.error(reply.error);
        return;
      }
      applyGeneratedBody(reply.data.body, "Reply created");
    } catch (error) {
      if (mountedRef.current) {
        toast.error(
          error instanceof Error ? error.message : "Could not create reply"
        );
      }
    } finally {
      if (mountedRef.current) {
        setAiAction(null);
      }
    }
  };

  return {
    aiAction,
    aiModelLabel: aiModel.label,
    canClean,
    canCreateReply,
    canSend: mailApi !== undefined && !isBusy,
    clean,
    composer,
    createReply,
    currentDraft,
    discard,
    isBusy,
    isSending,
    recipients,
    send,
    setComposer,
    setRecipients,
  };
};
