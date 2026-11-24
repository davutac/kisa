import { createStore } from "zustand/vanilla";

import type {
  MailDraftInput,
  MailSendCancelReply,
  MailSendResult,
} from "@/shared/ipc/mail";
import type { UndoOffer, UndoOutcome } from "@/undo/undo-provider";

import { describeSendOutcome } from "./send-outcome";

type SendReply =
  | { readonly data: MailSendResult; readonly ok: true }
  | { readonly error: string; readonly ok: false };

/** A message main is holding for the Undo send delay. */
export interface HeldSend {
  /** Takes it back, if the delay has not run out. */
  readonly cancel: () => Promise<MailSendCancelReply>;
  readonly delayMs: number;
  /**
   * Readies the message's return before Undo asks main, for a return that
   * must not miss main putting the draft back; what it returns calls that
   * off when Undo does not go through.
   */
  readonly expectRestore?: () => () => void;
  /** Where the saved draft is if sending fails, for the failure toast. */
  readonly keptIn: string;
  /** Puts the message in front of the user again: after Undo, or a failure. */
  readonly restore?: () => void;
  /** Answers once the message has gone out, or was taken back. */
  readonly send: () => Promise<SendReply>;
}

const settle = async (send: () => Promise<SendReply>): Promise<SendReply> => {
  try {
    return await send();
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not send message",
      ok: false,
    };
  }
};

/**
 * Sending as an Undo offer: on offer until main's delay runs out, then
 * withdrawn as the toast says the message went out, or that it did not and
 * where its draft is. The composer has closed by then; this outlives it.
 */
export const toUndoSendOffer = (held: HeldSend): UndoOffer => {
  const reply = settle(held.send);

  return {
    durationMs: held.delayMs,
    message: "Sending…",
    outcome: reply.then((answer): UndoOutcome => {
      if (!answer.ok) {
        // The composer is gone by now, so this toast stays until dismissed.
        const { restore } = held;
        return {
          action:
            restore === undefined
              ? undefined
              : { label: "Open", onAction: restore },
          description: `${answer.error}. ${held.keptIn}`,
          kind: "failed",
          message: "Message not sent",
          stays: true,
        };
      }
      return answer.data.kind === "canceled"
        ? { kind: "confirmed" }
        : { kind: "done", ...describeSendOutcome(answer.data) };
    }),
    undo: async () => {
      const callOff = held.expectRestore?.();
      let canceled: MailSendCancelReply;
      try {
        canceled = await held.cancel();
      } catch (error) {
        callOff?.();
        throw error;
      }
      if (!canceled.ok) {
        callOff?.();
        throw new Error(canceled.error);
      }
      if (canceled.data === "too-late") {
        callOff?.();
        throw new Error("Too late to undo: the message is on its way");
      }
      // The send answers too once main has put the draft back.
      await reply;
      held.restore?.();
    },
    undoneMessage: "Sending undone",
  };
};

/**
 * Drafts Undo took back, waiting to be opened again: a new email by the
 * compose page, mounted or about to be, a reply by its conversation.
 */
interface UndoneDrafts {
  /** A new email for the compose page to take back up. */
  readonly compose?: MailDraftInput;
  /** Replies whose conversation should open their composer. */
  readonly replies: ReadonlySet<string>;
}

export const undoneDrafts = createStore<UndoneDrafts>()(() => ({
  replies: new Set(),
}));

export const restoreComposeDraft = (draft: MailDraftInput): void => {
  undoneDrafts.setState({ compose: draft });
};

export const takeComposeDraft = (): MailDraftInput | undefined => {
  const { compose } = undoneDrafts.getState();
  if (compose !== undefined) {
    undoneDrafts.setState({ compose: undefined });
  }
  return compose;
};

export const restoreReplyDraft = (draftId: string): void => {
  undoneDrafts.setState(({ replies }) => ({
    replies: new Set([...replies, draftId]),
  }));
};

/** Whether this reply was taken back, forgetting it once asked. */
export const takeReplyDraft = (draftId: string): boolean => {
  const { replies } = undoneDrafts.getState();
  if (!replies.has(draftId)) {
    return false;
  }
  undoneDrafts.setState({
    replies: new Set([...replies].filter((id) => id !== draftId)),
  });
  return true;
};
