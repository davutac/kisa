import { useEffect, useMemo, useRef } from "react";

import type { EmailComposerValue } from "@/components/mail/email-composer";
import { useCleanDraftHistory } from "@/components/mail/use-clean-draft-history";
import type { useComposerFocus } from "@/components/mail/use-composer-focus";
import { useAiModelSelection } from "@/hooks/use-ai-model-selection";
import { getAiApi } from "@/platform/desktop";
import {
  appendEmailSignatureHtml,
  removeEmailSignature,
} from "@/shared/email-signature";
import { truncateGmailSubject } from "@/shared/gmail-subject";

import { useNewMessageStore, useNewMessageStoreApi } from "./new-message-store";

const MESSAGES = {
  applyError: "Could not update the email draft",
  cleaned: "Draft cleaned up",
  failed: "Could not clean up the draft",
};

export const useNewMessageCleanHistory = ({
  focus,
  isOpen,
}: {
  focus: ReturnType<typeof useComposerFocus>;
  isOpen: boolean;
}) => {
  const store = useNewMessageStoreApi();
  const history = useNewMessageStore((state) => state.cleanHistory);
  const composer = useNewMessageStore((state) => state.composer);
  const isSending = useNewMessageStore((state) => state.isSending);
  const resetHistory = useNewMessageStore((state) => state.resetCleanHistory);
  const selectedVersionId = useNewMessageStore(
    (state) => state.selectedCleanVersionId
  );
  const setHistory = useNewMessageStore((state) => state.setCleanHistory);
  const setComposer = useNewMessageStore((state) => state.setComposer);
  const setSelectedVersionId = useNewMessageStore(
    (state) => state.setSelectedCleanVersionId
  );
  const setSubject = useNewMessageStore((state) => state.setSubject);
  const subject = useNewMessageStore((state) => state.subject);
  const aiApi = useMemo(() => getAiApi(), []);
  const model = useAiModelSelection();
  const isOpenRef = useRef(isOpen);

  useEffect(() => {
    isOpenRef.current = isOpen;
    return () => {
      isOpenRef.current = false;
    };
  }, [isOpen]);

  const canClean =
    model.selection !== null &&
    (subject.trim().length > 0 || !composer.isEmpty) &&
    !isSending;
  const controller = useCleanDraftHistory({
    aiApi,
    applyVersion: (version) => {
      const { signature } = store.getState();
      const body =
        signature === undefined
          ? version.body
          : appendEmailSignatureHtml(version.body, signature.body);
      if (!focus.replaceContent("message", body)) {
        return false;
      }
      setSubject(version.subject);
      return true;
    },
    canClean,
    getState: () => {
      const state = store.getState();
      const body =
        state.signature === undefined
          ? state.composer
          : removeEmailSignature(state.composer, state.signature.body);
      return {
        draft: {
          body: body.html,
          key: state.draftId,
          subject: state.subject,
        },
        history: state.cleanHistory,
        selectedVersionId: state.selectedCleanVersionId,
      };
    },
    isActive: () => isOpenRef.current,
    isInteractionDisabled: isSending,
    messages: MESSAGES,
    model: model.selection,
    setHistory,
    setSelectedVersionId,
  });
  const selectedVersion =
    history.find(({ id }) => id === selectedVersionId) ?? null;

  const updateComposer = (nextComposer: EmailComposerValue): void => {
    setComposer(nextComposer);
    const { signature } = store.getState();
    const authoredBody =
      signature === undefined
        ? nextComposer
        : removeEmailSignature(nextComposer, signature.body);
    if (
      selectedVersion !== null &&
      authoredBody.html !== selectedVersion.body
    ) {
      setSelectedVersionId(null);
    }
  };

  const updateSubject = (nextSubject: string): void => {
    setSubject(nextSubject);
    if (
      selectedVersion !== null &&
      truncateGmailSubject(nextSubject) !== selectedVersion.subject
    ) {
      setSelectedVersionId(null);
    }
  };

  return {
    canClean,
    cleanDraft: controller.clean,
    dismissVersion: controller.dismissVersion,
    isCleaning: controller.isCleaning,
    modelLabel: model.label,
    reset: resetHistory,
    selectVersion: controller.selectVersion,
    updateComposer,
    updateSubject,
  };
};
