import type { MailApi } from "@/platform/desktop";
import type { MailDraftChanged, MailDraftInput } from "@/shared/ipc/mail";

interface ReplyDraftPersistenceOptions {
  readonly accountId: string;
  readonly api: Pick<MailApi, "discardDraft" | "saveDraft">;
  readonly draftId: string;
  readonly onError: (message: string) => void;
}

export interface ReplyDraftPersistence {
  /** This window sent the reply or is discarding its draft. */
  readonly finalize: () => void;
  readonly observe: (change: MailDraftChanged) => void;
  /** This window's own discard failed, so the draft is still there. */
  readonly reopen: () => void;
  /** The save that follows the user's edits while the composer is open. */
  readonly save: (draft: MailDraftInput) => Promise<void>;
  /** The composer closed: keep what was written, or drop an untouched draft. */
  readonly settle: (draft: MailDraftInput, isEmpty: boolean) => Promise<void>;
}

type DraftWriteReply =
  | { readonly error: string; readonly ok: false }
  | { readonly ok: true };

/**
 * Decides whether one open reply composer may still write its draft. A draft
 * ends when this window sends or discards it, and when another window on the
 * same conversation does: that removal closes this composer, and neither the
 * close nor a save already waiting may write the draft back. Text typed here
 * since the last save is dropped with it.
 */
export const createReplyDraftPersistence = ({
  accountId,
  api,
  draftId,
  onError,
}: ReplyDraftPersistenceOptions): ReplyDraftPersistence => {
  let finalized = false;
  // Kept apart from `finalized`: a failed discard here reopens the draft, but
  // cannot bring back one that is already gone.
  let removedElsewhere = false;

  const write = async (run: () => Promise<DraftWriteReply>): Promise<void> => {
    if (finalized || removedElsewhere) {
      return;
    }
    try {
      const reply = await run();
      if (!reply.ok) {
        onError(reply.error);
      }
    } catch {
      onError("Could not save draft");
    }
  };

  return {
    finalize: () => {
      finalized = true;
    },
    observe: (change) => {
      if (
        change.kind === "remove" &&
        change.draftId === draftId &&
        (change.accountId === undefined || change.accountId === accountId)
      ) {
        removedElsewhere = true;
      }
    },
    reopen: () => {
      finalized = false;
    },
    save: (draft) => write(() => api.saveDraft(draft)),
    settle: (draft, isEmpty) =>
      write(() =>
        isEmpty
          ? api.discardDraft({ accountId: draft.accountId, draftId: draft.id })
          : api.saveDraft(draft)
      ),
  };
};
