import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { areMailDraftInputsEqual } from "@/mail/mail-draft";
import { getScheduledMailApi } from "@/platform/desktop";
import { formatScheduledAt } from "@/scheduled/schedule-time";
import type { MailDraftInput } from "@/shared/ipc/mail";
import type {
  ScheduledMailEditAction,
  ScheduledMailEditSession,
} from "@/shared/ipc/scheduled-mail";

import { shouldConfirmScheduledEditorClose } from "./new-message-delivery";
import { useNewMessageStore } from "./new-message-store";
import { runScheduledComposerEditAction } from "./scheduled-composer-edit-action";

interface UseScheduledComposerOptions {
  readonly canSend: boolean;
  readonly currentDraft: MailDraftInput;
  readonly hasPendingReschedule: boolean;
  readonly isBusy: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly onSessionChange: (session: ScheduledMailEditSession) => void;
  readonly scheduledEdit?: ScheduledMailEditSession;
  readonly selectedAccountId: string;
}

export const useScheduledComposer = ({
  canSend,
  currentDraft,
  hasPendingReschedule,
  isBusy,
  onOpenChange,
  onSessionChange,
  scheduledEdit,
  selectedAccountId,
}: UseScheduledComposerOptions) => {
  const confirm = useConfirm();
  const api = useMemo(() => getScheduledMailApi(), []);
  const setIsScheduling = useNewMessageStore((state) => state.setIsScheduling);
  const setIsSending = useNewMessageStore((state) => state.setIsSending);
  const currentDraftRef = useRef(currentDraft);
  const sessionRef = useRef(scheduledEdit);

  useEffect(() => {
    currentDraftRef.current = currentDraft;
  }, [currentDraft]);
  useEffect(() => {
    sessionRef.current = scheduledEdit;
  }, [scheduledEdit]);

  const isEdit = scheduledEdit !== undefined;
  const isDirty =
    scheduledEdit !== undefined &&
    !areMailDraftInputsEqual(currentDraft, scheduledEdit.draft);
  const canSchedule = canSend && api !== undefined;

  const confirmPossibleDuplicate = (
    actionLabel: "Reschedule" | "Send again"
  ): Promise<boolean> => {
    if (scheduledEdit?.item.attentionReason !== "outcome-unknown") {
      return Promise.resolve(true);
    }
    return confirm({
      cancelLabel: "Keep scheduled",
      confirmLabel: actionLabel,
      confirmVariant: "destructive",
      description:
        "Gmail may already have sent this email. Check Sent first; continuing can create a duplicate.",
      title: "Delivery could not be confirmed",
    });
  };

  const runEditAction = ({
    action,
    errorMessage,
    onFinished,
    onSaved,
    setPending,
  }: {
    readonly action: ScheduledMailEditAction;
    readonly errorMessage: string;
    readonly onFinished?: () => void;
    readonly onSaved?: () => void;
    readonly setPending: (pending: boolean) => void;
  }): Promise<boolean> => {
    const session = sessionRef.current;
    if (!(session && api) || isBusy) {
      return Promise.resolve(false);
    }
    return runScheduledComposerEditAction({
      action,
      errorMessage,
      finishEdit: api.finishEdit,
      onError: (message) => toast.error(message),
      onFinished,
      onSaved: (nextSession) => {
        sessionRef.current = nextSession;
        onSessionChange(nextSession);
        onSaved?.();
      },
      session,
      setPending,
    });
  };

  const finishEdit = (
    action: ScheduledMailEditAction,
    successMessage?: string
  ): Promise<boolean> =>
    runEditAction({
      action,
      errorMessage: "Could not update scheduled email",
      onFinished: () => {
        if (successMessage !== undefined) {
          toast.success(successMessage);
        }
        onOpenChange(false);
      },
      setPending: setIsScheduling,
    });

  const sendNow = async (): Promise<void> => {
    if (!(scheduledEdit && api && canSend)) {
      return;
    }
    const allowPossibleDuplicate = await confirmPossibleDuplicate("Send again");
    if (!allowPossibleDuplicate) {
      return;
    }
    await runEditAction({
      action: {
        allowPossibleDuplicate,
        draft: currentDraftRef.current,
        kind: "send-now",
      },
      errorMessage: "Could not send message",
      onFinished: () => {
        toast("Sending…");
        onOpenChange(false);
      },
      setPending: setIsSending,
    });
  };

  const save = (): Promise<boolean> =>
    runEditAction({
      action: { draft: currentDraftRef.current, kind: "save" },
      errorMessage: "Could not save scheduled email",
      onSaved: () => toast.success("Scheduled email saved"),
      setPending: setIsScheduling,
    });

  const discard = async (): Promise<boolean> => {
    const confirmed = await confirm({
      cancelLabel: "Keep scheduled",
      confirmLabel: "Discard email",
      confirmVariant: "destructive",
      description:
        "This permanently deletes the scheduled email and its draft. This cannot be undone.",
      title: "Discard scheduled email?",
    });
    return confirmed
      ? finishEdit({ kind: "discard" }, "Scheduled email discarded")
      : false;
  };

  const schedule = async (scheduledAt: number): Promise<boolean> => {
    if (!(canSchedule && api)) {
      return false;
    }
    const draft = currentDraftRef.current;
    if (scheduledEdit !== undefined) {
      const allowPossibleDuplicate =
        await confirmPossibleDuplicate("Reschedule");
      return allowPossibleDuplicate
        ? runEditAction({
            action: {
              allowPossibleDuplicate,
              draft,
              kind: "reschedule",
              scheduledAt,
            },
            errorMessage: "Could not reschedule email",
            onSaved: () =>
              toast.success(
                `Rescheduled for ${formatScheduledAt(scheduledAt)}`
              ),
            setPending: setIsScheduling,
          })
        : false;
    }

    setIsScheduling(true);
    try {
      const reply = await api.schedule({
        accountId: selectedAccountId,
        draft,
        draftId: draft.id,
        scheduledAt,
      });
      if (!reply.ok) {
        toast.error(reply.error);
        return false;
      }
      toast.success("Email scheduled", {
        description: formatScheduledAt(scheduledAt),
      });
      onOpenChange(false);
      return true;
    } catch {
      toast.error("Could not schedule email");
      return false;
    } finally {
      setIsScheduling(false);
    }
  };

  const requestClose = async (): Promise<void> => {
    if (isBusy) {
      return;
    }
    if (scheduledEdit === undefined) {
      onOpenChange(false);
      return;
    }
    if (
      shouldConfirmScheduledEditorClose(isDirty, hasPendingReschedule) &&
      !(await confirm({
        cancelLabel: "Keep editing",
        confirmLabel: "Discard changes",
        confirmVariant: "destructive",
        description:
          "Your unsaved edits will be lost. The original scheduled email will remain queued.",
        title: "Discard unsaved changes?",
      }))
    ) {
      return;
    }
    onOpenChange(false);
  };

  return {
    canSchedule,
    discard,
    isDirty,
    isEdit,
    requestClose,
    save,
    schedule,
    sendNow,
  };
};
