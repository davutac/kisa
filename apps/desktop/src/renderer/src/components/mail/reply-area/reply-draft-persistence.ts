import type { MailApi } from "@/platform/desktop";
import type { MailDraftChanged, MailDraftInput } from "@/shared/ipc/mail";

interface ReplyDraftPersistenceOptions {
  readonly accountId: string;
  readonly api: Pick<MailApi, "discardDraft" | "saveDraft">;
  readonly initial: MailDraftInput;
  readonly onError: (message: string) => void;
}

export interface ReplyDraftPersistence {
  /** This window sent the reply or is discarding its draft. */
  readonly finalize: () => void;
  readonly observe: (change: MailDraftChanged) => void;
  /** This window's own discard failed, so the draft is still there. */
  readonly reopen: () => void;
  /**
   * The save that follows the user's edits while the composer is open.
   * Whether the draft is stored as given, as sending with Undo needs.
   */
  readonly save: (draft: MailDraftInput) => Promise<boolean>;
  /** The composer closed: keep what was written, or drop an untouched draft. */
  readonly settle: (draft: MailDraftInput, isEmpty: boolean) => Promise<void>;
}

type DraftWriteReply =
  | { readonly error: string; readonly ok: false }
  | { readonly ok: true };

/**
 * What a draft says, the same in every window. Attachment references are
 * per window, so attachments are compared by the record they stand for.
 */
const contentKey = (draft: MailDraftInput): string =>
  JSON.stringify([
    draft.body,
    draft.subject,
    draft.to,
    draft.cc,
    draft.bcc,
    draft.signature ?? null,
    draft.attachments.map((attachment) => [
      attachment.id,
      attachment.contentId ?? null,
    ]),
  ]);

/**
 * Decides what one open reply composer writes, if anything.
 *
 * It writes only what the user changed here: opening a draft, or closing it
 * unchanged, writes nothing, so a window holding an older copy cannot put it
 * back over a newer one. Once another window has written the draft, an
 * unchanged composer here leaves that copy alone, even when its own copy is
 * empty. Two windows that both edit the draft still race: the later write
 * wins.
 *
 * A draft ends when this window sends or discards it, and when another
 * window on the same conversation does: that removal closes this composer,
 * and neither the close nor a save already waiting may write the draft back.
 * Text typed here since the last save is dropped with it.
 */
export const createReplyDraftPersistence = ({
  accountId,
  api,
  initial,
  onError,
}: ReplyDraftPersistenceOptions): ReplyDraftPersistence => {
  const draftId = initial.id;
  let finalized = false;
  // Kept apart from `finalized`: a failed discard here reopens the draft, but
  // cannot bring back one that is already gone.
  let removedElsewhere = false;
  /** What this window last stored, or opened with. */
  let stored = contentKey(initial);
  /** Writes issued here whose echo has not come back yet, oldest first. */
  let ownWrites: string[] = [];
  let writtenElsewhere = false;

  const run = async (
    request: () => Promise<DraftWriteReply>
  ): Promise<boolean> => {
    try {
      const reply = await request();

      if (!reply.ok) {
        onError(reply.error);
      }

      return reply.ok;
    } catch {
      onError("Could not save draft");

      return false;
    }
  };

  const save = async (draft: MailDraftInput): Promise<boolean> => {
    const key = contentKey(draft);

    if (finalized || removedElsewhere) {
      return false;
    }

    if (key === stored) {
      return true;
    }

    ownWrites.push(key);

    if (await run(() => api.saveDraft(draft))) {
      stored = key;
      writtenElsewhere = false;

      return true;
    }

    ownWrites = ownWrites.filter((write) => write !== key);

    return false;
  };

  const discard = async (draft: MailDraftInput): Promise<void> => {
    await run(() =>
      api.discardDraft({ accountId: draft.accountId, draftId: draft.id })
    );
  };

  return {
    finalize: () => {
      finalized = true;
    },
    observe: (change) => {
      if (change.kind === "remove") {
        if (
          change.draftId === draftId &&
          (change.accountId === undefined || change.accountId === accountId)
        ) {
          removedElsewhere = true;
        }

        return;
      }

      if (change.draft.id !== draftId) {
        return;
      }

      const key = contentKey(change.draft);
      const echo = ownWrites.indexOf(key);

      if (echo !== -1) {
        // Writes commit in order: earlier echoes are no longer coming.
        ownWrites = ownWrites.slice(echo + 1);

        return;
      }

      if (key !== stored) {
        writtenElsewhere = true;
      }
    },
    reopen: () => {
      finalized = false;
    },
    save,
    settle: async (draft, isEmpty) => {
      if (finalized || removedElsewhere) {
        return;
      }

      if (isEmpty) {
        // Empty here, but another window's copy may not be.
        if (!writtenElsewhere) {
          await discard(draft);
        }

        return;
      }

      await save(draft);
    },
  };
};
