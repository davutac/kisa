import type {
  ScheduledMailEditAction,
  ScheduledMailEditSession,
  ScheduledMailFinishEditReply,
  ScheduledMailFinishEditRequest,
} from "@/shared/ipc/scheduled-mail";

interface ScheduledComposerEditActionOptions {
  readonly action: ScheduledMailEditAction;
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

export const runScheduledComposerEditAction = async ({
  action,
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
    const reply = await finishEdit({
      accountId: session.item.accountId,
      action,
      draftId: session.item.draftId,
    });
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
