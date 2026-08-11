import { useCallback } from "react";
import { toast } from "sonner";

import type { MailApi } from "@/platform/desktop";
import type { MailDraft, MailDraftInput } from "@/shared/ipc/mail";

export const toOptimisticStash = (draft: MailDraftInput): MailDraft => {
  const now = Date.now();
  return { ...draft, createdAt: now, updatedAt: now };
};

export const upsertStash = (
  stashes: readonly MailDraft[],
  draft: MailDraft
): readonly MailDraft[] =>
  [draft, ...stashes.filter(({ id }) => id !== draft.id)].toSorted(
    (left, right) => right.updatedAt - left.updatedAt
  );

export const runQueuedDraftOperation = async (
  previous: Promise<void>,
  operation: () => Promise<void>
): Promise<void> => {
  try {
    await previous;
  } catch {
    // A failed operation must not prevent later stashes from being persisted.
  }
  await operation();
};

export const useDraftPersistence = (mailApi: MailApi | undefined) => {
  const persistDraft = useCallback(
    async (draft: MailDraftInput): Promise<boolean> => {
      if (mailApi === undefined) {
        return false;
      }
      try {
        const reply = await mailApi.saveDraft(draft);
        if (!reply.ok) {
          toast.error(reply.error);
          return false;
        }
        return true;
      } catch {
        toast.error("Could not save draft");
        return false;
      }
    },
    [mailApi]
  );

  const popDraft = useCallback(
    async (draft: MailDraftInput): Promise<boolean> => {
      if (mailApi === undefined) {
        return false;
      }
      try {
        const reply = await mailApi.discardDraft({
          ...(draft.accountId === undefined
            ? {}
            : { accountId: draft.accountId }),
          draftId: draft.id,
        });
        if (!reply.ok) {
          toast.error(reply.error);
          return false;
        }
        return true;
      } catch {
        toast.error("Could not update stashes");
        return false;
      }
    },
    [mailApi]
  );

  return { persistDraft, popDraft };
};
