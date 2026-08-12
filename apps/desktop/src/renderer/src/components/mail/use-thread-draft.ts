import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useThreadConversationStore } from "@/components/mail/thread-conversation-store";
import { createThreadMailDraft } from "@/mail/mail-draft";
import { getInitialReplyRecipients } from "@/mail/reply-recipients";
import type { MailMessageAction } from "@/mail/reply-recipients";
import { getMailApi } from "@/platform/desktop";
import type { GmailThreadMessage, MailDraftInput } from "@/shared/ipc/mail";

export const getThreadDraftAction = (
  draft: MailDraftInput
): MailMessageAction => (draft.kind === "new" ? "reply" : draft.kind);

const getDraftActionLabel = (action: MailMessageAction): string => {
  if (action === "forward") {
    return "forward";
  }
  if (action === "reply-all") {
    return "reply all";
  }
  return "reply";
};

export const useThreadDraft = ({
  accountId,
  messages,
  selectedMessage,
  threadId,
}: {
  accountId: string;
  messages: readonly GmailThreadMessage[];
  selectedMessage: GmailThreadMessage;
  threadId: string;
}) => {
  const mailApi = useMemo(() => getMailApi(), []);
  const [draft, setDraft] = useState<MailDraftInput | null>(null);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [isDiscardingDraft, setIsDiscardingDraft] = useState(false);
  const [isLoadingDraft, setIsLoadingDraft] = useState(mailApi !== undefined);
  const restoredDraftIdRef = useRef<string | null>(null);
  const openMessage = useThreadConversationStore((state) => state.openMessage);
  const draftMessage = messages.find(
    (message) => message.id === draft?.messageId
  );

  useEffect(() => {
    if (draft === null) {
      restoredDraftIdRef.current = null;
      return;
    }

    if (draftMessage === undefined || restoredDraftIdRef.current === draft.id) {
      return;
    }

    restoredDraftIdRef.current = draft.id;
    openMessage(draftMessage.id);
  }, [draft, draftMessage, openMessage]);

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
        setIsComposerOpen(reply.data !== null);
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
          setIsComposerOpen(false);
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

  const clearDraft = useCallback((): void => {
    setDraft(null);
    setIsComposerOpen(false);
  }, []);

  const createDraft = useCallback(
    async (created: MailDraftInput): Promise<void> => {
      setDraft(created);
      setIsComposerOpen(true);
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
    },
    [mailApi]
  );

  const continueDraft = useCallback((): void => {
    if (draftMessage === undefined) {
      return;
    }

    openMessage(draftMessage.id);
    setIsComposerOpen(true);
  }, [draftMessage, openMessage]);

  const startAction = useCallback(
    (action: MailMessageAction): void => {
      if (isLoadingDraft) {
        return;
      }

      if (draft !== null) {
        const draftAction = getThreadDraftAction(draft);
        if (draftAction === action) {
          continueDraft();
          return;
        }

        toast.info(
          `A ${getDraftActionLabel(draftAction)} draft is already in progress`
        );
        return;
      }

      void createDraft(
        createThreadMailDraft({
          accountId,
          action,
          messageId: selectedMessage.id,
          recipients: getInitialReplyRecipients(
            accountId,
            action,
            selectedMessage
          ),
          threadId,
        })
      );
    },
    [
      accountId,
      continueDraft,
      createDraft,
      draft,
      isLoadingDraft,
      selectedMessage,
      threadId,
    ]
  );

  const discardDraft = useCallback(async (): Promise<void> => {
    if (draft === null || isDiscardingDraft) {
      return;
    }

    if (mailApi === undefined) {
      clearDraft();
      return;
    }

    setIsDiscardingDraft(true);
    try {
      const reply = await mailApi.discardDraft({
        accountId,
        draftId: draft.id,
      });
      if (!reply.ok) {
        toast.error(reply.error);
        return;
      }

      clearDraft();
    } catch {
      toast.error("Could not discard draft");
    } finally {
      setIsDiscardingDraft(false);
    }
  }, [accountId, clearDraft, draft, isDiscardingDraft, mailApi]);

  const closeComposer = useCallback((currentDraft: MailDraftInput): void => {
    setDraft(currentDraft);
    setIsComposerOpen(false);
  }, []);

  return {
    clearDraft,
    closeComposer,
    continueDraft,
    discardDraft,
    draft,
    draftMessage,
    isComposerOpen,
    isDiscardingDraft,
    isLoadingDraft,
    startAction,
  };
};
