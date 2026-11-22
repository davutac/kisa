import type {
  ScheduledMailEditAction,
  ScheduledMailEditSession,
  ScheduledMailFinishEditReply,
  ScheduledMailFinishEditRequest,
} from "@/shared/ipc/scheduled-mail";

interface ScheduledComposerEditActionOptions {
  readonly action: ScheduledMailEditAction;
  /** Asks whether to go ahead although the email may already have been sent. */
  readonly confirmPossibleDuplicate: () => Promise<boolean>;
  readonly errorMessage: string;
  readonly finishEdit: (
    request: ScheduledMailFinishEditRequest
  ) => Promise<ScheduledMailFinishEditReply>;
  readonly onError: (message: string) => void;
  readonly onFinished: (() => void) | undefined;
  readonly onSaved: (session: ScheduledMailEditSession) => void;
  readonly session: ScheduledMailEditSession;
  readonly setPending: (pending: boolean) => void;
}

/**
 * Runs one editor action. Main alone knows whether the email may already have
 * been sent, so an action never claims the user's acknowledgement up front:
 * it is asked for, and the action sent again with it, only when main says the
 * email is a possible duplicate.
 */
export const runScheduledComposerEditAction = async ({
  action,
  confirmPossibleDuplicate,
  errorMessage,
  finishEdit,
  onError,
  onFinished,
  onSaved,
  session,
  setPending,
}: ScheduledComposerEditActionOptions): Promise<boolean> => {
  setPending(true);
  try {
    const request = (
      requested: ScheduledMailEditAction
    ): ScheduledMailFinishEditRequest => ({
      accountId: session.item.accountId,
      action: requested,
      draftId: session.item.draftId,
    });
    let reply = await finishEdit(request(action));
    if (
      reply.ok &&
      reply.data.kind === "possible-duplicate" &&
      (action.kind === "reschedule" || action.kind === "send-now")
    ) {
      if (!(await confirmPossibleDuplicate())) {
        return false;
      }
      reply = await finishEdit(
        request({ ...action, allowPossibleDuplicate: true })
      );
    }
    if (!reply.ok) {
      onError(reply.error);
      return false;
    }
    if (action.kind === "save" || action.kind === "reschedule") {
      if (reply.data.kind !== "saved") {
        onError(errorMessage);
        return false;
      }
      onSaved(reply.data.session);
      return true;
    }
    if (reply.data.kind !== "finished") {
      onError(errorMessage);
      return false;
    }
    onFinished?.();
    return true;
  } catch {
    onError(errorMessage);
    return false;
  } finally {
    setPending(false);
  }
};
