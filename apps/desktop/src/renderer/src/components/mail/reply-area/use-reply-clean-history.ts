import type { RefObject } from "react";
import { useRef, useState } from "react";

import type { CleanDraftVersion } from "@/components/mail/clean-draft-history";
import type { EmailComposerValue } from "@/components/mail/email-composer";
import { useCleanDraftHistory } from "@/components/mail/use-clean-draft-history";
import type { getAiApi } from "@/platform/desktop";
import type { AiModelSelection } from "@/shared/ipc/ai";

const MESSAGES = {
  applyError: "Could not update the reply draft",
  cleaned: "Reply cleaned up",
  failed: "Could not clean up reply",
};

export const useReplyCleanHistory = ({
  aiApi,
  composer,
  isCreatingReply,
  isSending,
  model,
  mountedRef,
  replaceComposerContent,
  setComposer,
  subject,
}: {
  aiApi: ReturnType<typeof getAiApi>;
  composer: EmailComposerValue;
  isCreatingReply: boolean;
  isSending: boolean;
  model: AiModelSelection | null;
  mountedRef: RefObject<boolean>;
  replaceComposerContent: (content: string) => boolean;
  setComposer: (composer: EmailComposerValue) => void;
  subject: string;
}) => {
  const [history, setHistory] = useState<readonly CleanDraftVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null
  );
  const composerRef = useRef(composer);
  const historyRef = useRef(history);
  const selectedVersionIdRef = useRef(selectedVersionId);

  const updateHistory = (nextHistory: readonly CleanDraftVersion[]): void => {
    historyRef.current = nextHistory;
    setHistory(nextHistory);
  };
  const updateSelectedVersionId = (versionId: string | null): void => {
    selectedVersionIdRef.current = versionId;
    setSelectedVersionId(versionId);
  };
  const canClean =
    model !== null && !composer.isEmpty && !(isCreatingReply || isSending);
  const controller = useCleanDraftHistory({
    aiApi,
    applyVersion: (version) => replaceComposerContent(version.body),
    canClean,
    getState: () => ({
      draft: { body: composerRef.current.html, subject },
      history: historyRef.current,
      selectedVersionId: selectedVersionIdRef.current,
    }),
    isActive: () => mountedRef.current,
    isInteractionDisabled: isCreatingReply || isSending,
    messages: MESSAGES,
    model,
    setHistory: updateHistory,
    setSelectedVersionId: updateSelectedVersionId,
  });

  const updateComposer = (nextComposer: EmailComposerValue): void => {
    composerRef.current = nextComposer;
    setComposer(nextComposer);
    const selectedVersion = historyRef.current.find(
      ({ id }) => id === selectedVersionIdRef.current
    );
    if (
      selectedVersion !== undefined &&
      nextComposer.html !== selectedVersion.body
    ) {
      updateSelectedVersionId(null);
    }
  };

  return {
    canClean,
    clean: controller.clean,
    dismissVersion: controller.dismissVersion,
    history,
    isCleaning: controller.isCleaning,
    reset: controller.reset,
    selectVersion: controller.selectVersion,
    selectedVersionId,
    updateComposer,
  };
};
