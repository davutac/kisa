import type {
  MailBulkThreadMutationOperation,
  MailBulkThreadMutationReply,
  MailBulkThreadMutationRequest,
  MailThreadMutationReply,
  MailThreadRequest,
} from "@/shared/ipc/mail";
import type { UndoOffer, UndoOutcome } from "@/undo/undo-provider";

import type { PendingThreadChange } from "./pending-thread-changes";

/** What the server made of a thread action; never a rejection. */
export type ThreadActionOutcome =
  | {
      readonly description?: string;
      readonly kind: "failed";
      readonly message: string;
    }
  /** At least one conversation changed. */
  | {
      readonly failedCount: number;
      readonly kind: "done";
      readonly succeeded: readonly MailThreadRequest[];
    };

type ToastId = string;

export interface ThreadActionPorts {
  readonly bulkMutateThreads: (
    request: MailBulkThreadMutationRequest
  ) => Promise<MailBulkThreadMutationReply>;
  readonly notifyError: (
    message: string,
    options: { readonly description?: string; readonly id?: ToastId }
  ) => void;
  readonly notifySuccess: (message: string) => ToastId;
  readonly offerUndo: (offer: UndoOffer) => void;
  readonly showPending: (
    threads: readonly MailThreadRequest[],
    change: PendingThreadChange
  ) => () => void;
}

export interface ThreadActionPlan {
  readonly change: PendingThreadChange;
  /** The headline when only some conversations changed. */
  readonly failureMessage: string;
  /** Shown with the change, before the server answers. */
  readonly message: string;
  /** Takes the user away from the conversation, such as closing it. */
  readonly onLeave?: () => void;
  /**
   * Waits for the server before leaving, for a surface that cannot report a
   * failure once it has left, such as a conversation's own window.
   */
  readonly leaveAfterConfirmation?: boolean;
  readonly send: () => Promise<ThreadActionOutcome>;
  readonly threads: readonly MailThreadRequest[];
  readonly undo?: {
    readonly change: PendingThreadChange;
    readonly failureMessage: string;
    readonly undoneMessage: string;
  };
}

const conversationCount = (count: number): string =>
  `${count} conversation${count === 1 ? "" : "s"}`;

const describeFailed = (failedCount: number, total: number): string =>
  `${failedCount} of ${total} conversations could not be updated.`;

export const toThreadMutationOperation = (
  change: PendingThreadChange
): MailBulkThreadMutationOperation =>
  change.kind === "setLabel"
    ? { applied: change.applied, kind: "setLabel", labelId: change.labelId }
    : change;

/** One conversation's own IPC method. */
export const fromThreadReply = async (
  thread: MailThreadRequest,
  reply: () => Promise<MailThreadMutationReply>,
  failureMessage: string
): Promise<ThreadActionOutcome> => {
  try {
    const result = await reply();
    return result.ok
      ? { failedCount: 0, kind: "done", succeeded: [thread] }
      : { kind: "failed", message: result.error };
  } catch (error) {
    return {
      kind: "failed",
      message: error instanceof Error ? error.message : failureMessage,
    };
  }
};

/** A selection, which may change only in part. */
export const fromBulkReply = async (
  threads: readonly MailThreadRequest[],
  reply: () => Promise<MailBulkThreadMutationReply>,
  failureMessage: string
): Promise<ThreadActionOutcome> => {
  try {
    const result = await reply();

    if (!result.ok) {
      return { kind: "failed", message: result.error };
    }

    const { failed, succeeded } = result.data;

    return succeeded.length === 0
      ? {
          description: describeFailed(failed.length, threads.length),
          kind: "failed",
          message: failureMessage,
        }
      : { failedCount: failed.length, kind: "done", succeeded };
  } catch (error) {
    return {
      kind: "failed",
      message: error instanceof Error ? error.message : failureMessage,
    };
  }
};

const toUndoOutcome = (
  outcome: ThreadActionOutcome,
  failureMessage: string
): UndoOutcome => {
  if (outcome.kind === "failed") {
    return outcome;
  }

  return outcome.failedCount === 0
    ? { kind: "confirmed" }
    : {
        description: describeFailed(
          outcome.failedCount,
          outcome.succeeded.length + outcome.failedCount
        ),
        kind: "partial",
        message: failureMessage,
      };
};

const leaveOnceDone = async (
  outcome: Promise<ThreadActionOutcome>,
  leave: () => void
): Promise<void> => {
  const result = await outcome;

  if (result.kind === "done") {
    leave();
  }
};

const amendToast = async (
  ports: ThreadActionPorts,
  outcome: Promise<ThreadActionOutcome>,
  failureMessage: string,
  toastId: ToastId
): Promise<void> => {
  const amended = toUndoOutcome(await outcome, failureMessage);

  if (amended.kind !== "confirmed") {
    ports.notifyError(amended.message, {
      description: amended.description,
      id: toastId,
    });
  }
};

/** Sends the inverse for the conversations the action changed, if any. */
const reverseAction = async (
  ports: ThreadActionPorts,
  outcome: Promise<ThreadActionOutcome>,
  undo: NonNullable<ThreadActionPlan["undo"]>
): Promise<void> => {
  const result = await outcome;

  if (result.kind === "failed") {
    return;
  }

  let reply: MailBulkThreadMutationReply;

  try {
    reply = await ports.bulkMutateThreads({
      operation: toThreadMutationOperation(undo.change),
      threads: result.succeeded,
    });
  } catch (error) {
    throw new Error(undo.failureMessage, { cause: error });
  }

  if (!reply.ok) {
    throw new Error(reply.error);
  }
  if (reply.data.failed.length > 0) {
    throw new Error(
      `Could not undo for ${conversationCount(reply.data.failed.length)}`
    );
  }
};

/**
 * Shows an action as done at once, asks the server, and then lets the cache
 * speak: the pending change is dropped when the server answers, so a failure
 * puts back what the cache still has. Feedback appears with the change, and a
 * failure amends it. Undo waits for the answer and reverses only the
 * conversations that changed, so it never sends an inverse for a change that
 * did not happen.
 */
export const runThreadAction = (
  ports: ThreadActionPorts,
  plan: ThreadActionPlan
): Promise<ThreadActionOutcome> => {
  if (plan.threads.length === 0) {
    return Promise.resolve({ failedCount: 0, kind: "done", succeeded: [] });
  }

  const settle = ports.showPending(plan.threads, plan.change);
  let answered: ThreadActionOutcome | undefined;
  const outcome = plan.send().then((result) => {
    answered = result;
    settle();
    return result;
  });

  if (plan.onLeave !== undefined) {
    if (plan.leaveAfterConfirmation === true) {
      void leaveOnceDone(outcome, plan.onLeave);
    } else {
      plan.onLeave();
    }
  }

  const { undo } = plan;

  if (undo === undefined) {
    void amendToast(
      ports,
      outcome,
      plan.failureMessage,
      ports.notifySuccess(plan.message)
    );
    return outcome;
  }

  ports.offerUndo({
    message: plan.message,
    outcome: outcome.then((result) =>
      toUndoOutcome(result, plan.failureMessage)
    ),
    undo: async () => {
      if (answered?.kind === "failed") {
        return;
      }

      // Before the answer, every conversation shows as restored; after it,
      // only the ones that changed.
      const settleUndo = ports.showPending(
        answered?.succeeded ?? plan.threads,
        undo.change
      );

      try {
        await reverseAction(ports, outcome, undo);
      } finally {
        settleUndo();
      }
    },
    undoneMessage: undo.undoneMessage,
  });

  return outcome;
};
