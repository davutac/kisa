import { useState } from "react";
import { toast } from "sonner";

import type { CleanDraftVersion } from "@/components/mail/clean-draft-history";
import {
  appendPendingCleanDraftVersion,
  completePendingCleanDraftVersion,
  dismissCleanDraftVersion,
} from "@/components/mail/clean-draft-history";
import type { getAiApi } from "@/platform/desktop";
import type { AiModelSelection } from "@/shared/ipc/ai";

interface CleanableDraft {
  body: string;
  key?: string;
  subject: string;
}

interface CleanDraftHistoryState {
  draft: CleanableDraft;
  history: readonly CleanDraftVersion[];
  selectedVersionId: string | null;
}

interface CleanDraftHistoryMessages {
  applyError: string;
  cleaned: string;
  failed: string;
}

const isSameDraft = (left: CleanableDraft, right: CleanableDraft): boolean =>
  left.body === right.body &&
  left.key === right.key &&
  left.subject === right.subject;

export const useCleanDraftHistory = ({
  aiApi,
  applyVersion,
  canClean,
  getState,
  isActive,
  isInteractionDisabled,
  messages,
  model,
  setHistory,
  setSelectedVersionId,
}: {
  aiApi: ReturnType<typeof getAiApi>;
  applyVersion: (version: CleanDraftVersion) => boolean;
  canClean: boolean;
  getState: () => CleanDraftHistoryState;
  isActive: () => boolean;
  isInteractionDisabled: boolean;
  messages: CleanDraftHistoryMessages;
  model: AiModelSelection | null;
  setHistory: (history: readonly CleanDraftVersion[]) => void;
  setSelectedVersionId: (versionId: string | null) => void;
}) => {
  const [activeRequestCount, setActiveRequestCount] = useState(0);

  const reset = (): void => {
    setHistory([]);
    setSelectedVersionId(null);
  };

  const setRemainingHistory = (history: readonly CleanDraftVersion[]): void => {
    if (history.some(({ id }) => id !== "original")) {
      setHistory(history);
    } else {
      reset();
    }
  };

  const removePendingVersion = (versionId: string): void => {
    const { history } = getState();
    const nextHistory = history.filter(
      ({ id, status }) => id !== versionId || status !== "loading"
    );
    if (nextHistory.length !== history.length) {
      setRemainingHistory(nextHistory);
    }
  };

  const clean = async (): Promise<void> => {
    if (!(canClean && aiApi && model)) {
      return;
    }
    const initial = getState();
    const snapshot = initial.draft;
    const pending = appendPendingCleanDraftVersion(initial.history, snapshot);
    const requestedSelectionId =
      initial.history.length === 0 ? "original" : initial.selectedVersionId;
    setHistory(pending.history);
    if (initial.history.length === 0) {
      setSelectedVersionId("original");
    }

    setActiveRequestCount((current) => current + 1);
    try {
      const reply = await aiApi.cleanupDraft({
        body: snapshot.body,
        model,
        subject: snapshot.subject,
      });
      if (!isActive()) {
        return;
      }
      if (!reply.ok) {
        removePendingVersion(pending.version.id);
        toast.error(reply.error);
        return;
      }
      const latest = getState();
      const completed = completePendingCleanDraftVersion(
        latest.history,
        pending.version.id,
        reply.data
      );
      if (completed === undefined) {
        return;
      }
      setHistory(completed.history);
      const shouldApply =
        latest.history.at(-1)?.id === pending.version.id &&
        latest.selectedVersionId === requestedSelectionId &&
        isSameDraft(latest.draft, snapshot);
      if (!shouldApply) {
        toast.success("Clean version ready");
        return;
      }
      if (!applyVersion(completed.version)) {
        setSelectedVersionId(null);
        toast.error(messages.applyError);
        return;
      }
      setSelectedVersionId(completed.version.id);
      toast.success(messages.cleaned);
    } catch (error) {
      if (isActive()) {
        removePendingVersion(pending.version.id);
        toast.error(error instanceof Error ? error.message : messages.failed);
      }
    } finally {
      setActiveRequestCount((current) => Math.max(0, current - 1));
    }
  };

  const selectVersion = (version: CleanDraftVersion): void => {
    if (isInteractionDisabled || version.status === "loading") {
      return;
    }
    if (!applyVersion(version)) {
      toast.error(messages.applyError);
      return;
    }
    setSelectedVersionId(version.id);
  };

  const dismissVersion = (version: CleanDraftVersion): void => {
    if (isInteractionDisabled || version.id === "original") {
      return;
    }
    const current = getState();
    const dismissal = dismissCleanDraftVersion(
      current.history,
      version.id,
      current.selectedVersionId
    );
    if (version.id !== current.selectedVersionId) {
      setRemainingHistory(dismissal.history);
      return;
    }
    const fallback = dismissal.selectedVersion;
    if (fallback === null || !applyVersion(fallback)) {
      toast.error(messages.applyError);
      return;
    }
    if (dismissal.history.some(({ id }) => id !== "original")) {
      setHistory(dismissal.history);
      setSelectedVersionId(fallback.id);
    } else {
      reset();
    }
  };

  return {
    clean,
    dismissVersion,
    isCleaning: activeRequestCount > 0,
    reset,
    selectVersion,
  };
};
