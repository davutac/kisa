import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useThreadConversationStore } from "@/components/mail/thread-conversation-store";
import { runWithCleanup } from "@/lib/run-with-cleanup";
import { createThreadMailDraft } from "@/mail/mail-draft";
import { getInitialReplyRecipients } from "@/mail/reply-recipients";
import type { MailMessageAction } from "@/mail/reply-recipients";
import type { MailApi } from "@/platform/desktop";
import { getMailApi } from "@/platform/desktop";
import type { ThreadMessage, MailDraftInput } from "@/shared/ipc/mail";
import { useAccountSettings } from "@/state/account-settings";

import { adoptSavedDraft, getThreadDraftStart } from "./thread-draft-state";
import type { ThreadDraftLoad } from "./thread-draft-state";

type ThreadDraftFetch =
  | { readonly draft: MailDraftInput | null; readonly kind: "loaded" }
  | { readonly kind: "failed" };

const fetchThreadDraft = async (
  mailApi: MailApi,
  accountId: string,
  threadId: string
): Promise<ThreadDraftFetch> => {
  try {
    const reply = await mailApi.loadThreadDraft({ accountId, threadId });
    if (reply.ok) {
      return { draft: reply.data, kind: "loaded" };
    }
    toast.error(reply.error);
  } catch {
    toast.error("Could not load saved reply");
  }
  return { kind: "failed" };
};

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
  messages: readonly ThreadMessage[];
  selectedMessage: ThreadMessage;
  threadId: string;
}) => {
  const { emailSignature } = useAccountSettings(accountId);
  const mailApi = useMemo(() => getMailApi(), []);
  const [draft, setDraft] = useState<MailDraftInput | null>(null);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [isDiscardingDraft, setIsDiscardingDraft] = useState(false);
  // Until a load succeeds, whether a draft is stored is unknown.
  const [loadState, setLoadState] = useState<ThreadDraftLoad>(
    mailApi === undefined ? "loaded" : "loading"
  );
  const isLoadingDraft = loadState === "loading";
  const isActiveRef = useRef(false);
  const isComposerOpenRef = useRef(isComposerOpen);
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
    isComposerOpenRef.current = isComposerOpen;
  }, [isComposerOpen]);

  const applyFetch = useCallback((fetched: ThreadDraftFetch): void => {
    if (!isActiveRef.current) {
      return;
    }
    if (fetched.kind === "failed") {
      setLoadState("failed");
      return;
    }
    setLoadState("loaded");
    setDraft(fetched.draft);
    setIsComposerOpen(fetched.draft !== null);
  }, []);

  useEffect(() => {
    if (mailApi === undefined) {
      return;
    }
    isActiveRef.current = true;

    const load = async (): Promise<void> => {
      applyFetch(await fetchThreadDraft(mailApi, accountId, threadId));
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
        setDraft((current) =>
          adoptSavedDraft(current, change.draft, isComposerOpenRef.current)
        );
      }
    });

    return () => {
      isActiveRef.current = false;
      unsubscribe();
    };
  }, [accountId, applyFetch, mailApi, threadId]);

  const reloadDraft = useCallback(async (): Promise<void> => {
    if (mailApi === undefined) {
      return;
    }
    setLoadState("loading");
    applyFetch(await fetchThreadDraft(mailApi, accountId, threadId));
  }, [accountId, applyFetch, mailApi, threadId]);

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
      const start = getThreadDraftStart({ action, draft, load: loadState });
      if (start.kind === "wait") {
        return;
      }
      if (start.kind === "reload") {
        void reloadDraft();
        return;
      }
      if (start.kind === "continue") {
        continueDraft();
        return;
      }
      if (start.kind === "other-action") {
        toast.info(
          `A ${getDraftActionLabel(start.draftAction)} draft is already in progress`
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
          signature: emailSignature,
          threadId,
        })
      );
    },
    [
      accountId,
      continueDraft,
      createDraft,
      draft,
      emailSignature,
      loadState,
      reloadDraft,
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
    await runWithCleanup(
      async () => {
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
        }
      },
      () => {
        setIsDiscardingDraft(false);
      }
    );
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
