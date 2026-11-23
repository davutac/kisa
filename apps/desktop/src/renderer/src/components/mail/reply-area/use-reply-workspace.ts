import { useEffect, useMemo, useRef, useState } from "react";

import type { EmailComposerValue } from "@/components/mail/email-composer";
import type { EmailRecipients } from "@/components/mail/email-recipient-fields";
import { useOutgoingAttachments } from "@/components/mail/use-outgoing-attachments";
import { toast } from "@/components/ui/toast";
import { useAiModelSelection } from "@/hooks/use-ai-model-selection";
import { runWithCleanup } from "@/lib/run-with-cleanup";
import {
  isDraftBodyOnlySignature,
  isThreadMailDraftEmpty,
  toMailDraftComposerValue,
  updateMailDraftBody,
} from "@/mail/mail-draft";
import { getInitialReplyRecipients } from "@/mail/reply-recipients";
import type { MailMessageAction } from "@/mail/reply-recipients";
import { describeSendOutcome } from "@/mail/send-outcome";
import { getAiApi, getMailApi } from "@/platform/desktop";
import { appendEmailSignatureHtml } from "@/shared/email-signature";
import type { AiModelSelection } from "@/shared/ipc/ai";
import type { ThreadMessage, MailDraftInput } from "@/shared/ipc/mail";

import { createReplyDraftPersistence } from "./reply-draft-persistence";
import { useReplyCleanHistory } from "./use-reply-clean-history";

export const canCreateAiReply = (
  selection: AiModelSelection | null,
  action: MailMessageAction,
  isBusy: boolean
): boolean => selection !== null && action !== "forward" && !isBusy;

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
  message: ThreadMessage;
  onCancel: () => void;
  onSent: () => void;
  replaceComposerContent: (content: string) => boolean;
  threadId: string;
}) => {
  const aiApi = useMemo(() => getAiApi(), []);
  const aiModel = useAiModelSelection();
  const mailApi = useMemo(() => getMailApi(), []);
  const outgoingAttachments = useOutgoingAttachments(
    mailApi,
    draft.attachments,
    draft.body.html
  );
  const { activeAttachments, isAuthorizing, prepareAttachments } =
    outgoingAttachments;
  const [composer, setComposer] = useState<EmailComposerValue>(() =>
    toMailDraftComposerValue(draft)
  );
  const [isCreatingReply, setIsCreatingReply] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [recipients, setRecipients] = useState<EmailRecipients>(() => ({
    bcc: draft.bcc,
    cc: draft.cc,
    to: draft.to,
  }));
  const [signature, setSignature] = useState(draft.signature);
  const initialRecipients = useMemo(
    () => getInitialReplyRecipients(accountId, action, message),
    [accountId, action, message]
  );
  // One per mounted composer. The reply area is keyed by its draft's id, and
  // the conversation never replaces the draft while its composer is open, so
  // `draft` is the copy this composer opened with for as long as it is open.
  const persistence = useMemo(
    () =>
      mailApi === undefined
        ? undefined
        : createReplyDraftPersistence({
            accountId,
            api: mailApi,
            initial: draft,
            onError: (error) => toast.error(error),
          }),
    [accountId, draft, mailApi]
  );
  const mountedRef = useRef(false);
  const cleanHistory = useReplyCleanHistory({
    aiApi,
    composer,
    isCreatingReply,
    isSending,
    model: aiModel.selection,
    mountedRef,
    replaceComposerContent,
    setComposer,
    signature,
    subject: draft.subject,
  });
  const currentDraft = useMemo<MailDraftInput>(
    () => ({
      ...draft,
      attachments: activeAttachments,
      bcc: recipients.bcc,
      body: { html: composer.html, text: composer.text },
      cc: recipients.cc,
      signature,
      to: recipients.to,
    }),
    [
      activeAttachments,
      composer.html,
      composer.text,
      draft,
      recipients,
      signature,
    ]
  );
  const currentDraftRef = useRef(currentDraft);
  const isBusy =
    cleanHistory.isCleaning || isAuthorizing || isCreatingReply || isSending;
  const canCreateReply = canCreateAiReply(aiModel.selection, action, isBusy);
  const isBodyOnlySignature = isDraftBodyOnlySignature(currentDraft);

  useEffect(() => {
    currentDraftRef.current = currentDraft;
  }, [currentDraft]);

  useEffect(() => {
    if (persistence === undefined) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void persistence.save(currentDraft);
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [currentDraft, persistence]);

  useEffect(() => {
    if (mailApi === undefined || persistence === undefined) {
      return;
    }
    return mailApi.onDraftChanged(persistence.observe);
  }, [mailApi, persistence]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      queueMicrotask(() => {
        if (mountedRef.current || persistence === undefined) {
          return;
        }
        const latest = currentDraftRef.current;
        void persistence.settle(
          latest,
          isThreadMailDraftEmpty(latest, initialRecipients)
        );
      });
    };
  }, [initialRecipients, persistence]);

  const send = async (): Promise<void> => {
    if (mailApi === undefined || isBusy) {
      return;
    }
    setIsSending(true);
    await runWithCleanup(
      async () => {
        try {
          const preparedAttachments = await prepareAttachments(
            currentDraft.attachments
          );
          if (preparedAttachments === undefined) {
            return;
          }
          const reply = await mailApi.sendThreadMessage({
            accountId,
            action,
            attachments: preparedAttachments,
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
          persistence?.finalize();
          try {
            const discarded = await mailApi.discardDraft({
              accountId,
              draftId: draft.id,
            });
            if (!discarded.ok) {
              toast.error(discarded.error);
            }
          } catch {
            toast.error(
              "Message sent, but its local draft could not be removed"
            );
          }
          const notice = describeSendOutcome(reply.data);
          toast[notice.tone](notice.message);
          onSent();
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : "Could not send message"
          );
        }
      },
      () => {
        setIsSending(false);
      }
    );
  };

  const discard = async (): Promise<void> => {
    if (mailApi === undefined || isBusy) {
      return;
    }
    persistence?.finalize();
    try {
      const reply = await mailApi.discardDraft({
        accountId,
        draftId: draft.id,
      });
      if (!reply.ok) {
        persistence?.reopen();
        toast.error(reply.error);
        return;
      }
      onCancel();
    } catch {
      persistence?.reopen();
      toast.error("Could not discard draft");
    }
  };

  const createReply = async (instructions?: string): Promise<void> => {
    const model = aiModel.selection;
    if (!(aiApi && model && canCreateReply)) {
      return;
    }
    setIsCreatingReply(true);
    await runWithCleanup(
      async () => {
        try {
          const reply = await aiApi.generateReply({
            accountId,
            instructions,
            model,
            threadId,
          });
          if (!mountedRef.current) {
            return;
          }
          if (!reply.ok) {
            toast.error(reply.error);
            return;
          }
          const replyBody =
            signature === undefined
              ? reply.data.body
              : appendEmailSignatureHtml(reply.data.body, signature.body);
          if (!replaceComposerContent(replyBody)) {
            toast.error("Could not update the reply draft");
            return;
          }
          cleanHistory.reset();
          toast.success("Reply created");
        } catch (error) {
          if (mountedRef.current) {
            toast.error(
              error instanceof Error ? error.message : "Could not create reply"
            );
          }
        }
      },
      () => {
        if (mountedRef.current) {
          setIsCreatingReply(false);
        }
      }
    );
  };

  const updateComposer = (nextComposer: EmailComposerValue): void => {
    const nextDraft = updateMailDraftBody(currentDraftRef.current, {
      html: nextComposer.html,
      text: nextComposer.text,
    });
    setSignature(nextDraft.signature);
    cleanHistory.updateComposer(toMailDraftComposerValue(nextDraft));
  };

  return {
    aiModelLabel: aiModel.label,
    canClean: cleanHistory.canClean,
    canCreateReply,
    canSend: mailApi !== undefined && !composer.isEmpty && !isBusy,
    clean: cleanHistory.clean,
    cleanHistory: cleanHistory.history,
    composer,
    createReply,
    currentDraft,
    discard,
    dismissCleanVersion: cleanHistory.dismissVersion,
    isBodyOnlySignature,
    isBusy,
    isCreatingReply,
    isInputDisabled: isCreatingReply || isSending,
    isSending,
    outgoingAttachments,
    recipients,
    selectCleanVersion: cleanHistory.selectVersion,
    selectedCleanVersionId: cleanHistory.selectedVersionId,
    send,
    setComposer: updateComposer,
    setRecipients,
  };
};
