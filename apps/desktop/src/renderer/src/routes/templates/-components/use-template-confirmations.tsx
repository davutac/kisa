import { useBlocker } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";

import { ConfirmMessage, useConfirm } from "@/components/confirm-dialog";

interface UseTemplateConfirmationsOptions {
  isDirty: boolean;
  templateName?: string;
}

export const useTemplateConfirmations = ({
  isDirty,
  templateName,
}: UseTemplateConfirmationsOptions) => {
  const confirm = useConfirm();
  const blockerConfirmationPendingRef = useRef(false);
  const blocker = useBlocker({
    enableBeforeUnload: () => isDirty,
    shouldBlockFn: () => isDirty,
    withResolver: true,
  });

  const confirmDelete = useCallback(
    (name: string): Promise<boolean> =>
      confirm({
        confirmLabel: "Delete template",
        confirmVariant: "destructive",
        description: (
          <ConfirmMessage subject={name}>
            The template will be permanently deleted. This action cannot be
            undone.
          </ConfirmMessage>
        ),
        title: "Delete template?",
      }),
    [confirm]
  );
  const confirmDiscard = useCallback(
    (): Promise<boolean> =>
      confirm({
        cancelLabel: "Keep editing",
        confirmLabel: "Discard changes",
        confirmVariant: "destructive",
        description: (
          <ConfirmMessage subject={templateName?.trim() || "Untitled template"}>
            Your unsaved changes will be lost.
          </ConfirmMessage>
        ),
        title: "Discard unsaved changes?",
      }),
    [confirm, templateName]
  );

  useEffect(() => {
    if (blocker.status !== "blocked" || blockerConfirmationPendingRef.current) {
      return;
    }

    blockerConfirmationPendingRef.current = true;

    const settleBlocker = async (): Promise<void> => {
      const confirmed = await confirmDiscard();
      blockerConfirmationPendingRef.current = false;

      if (blocker.status !== "blocked") {
        return;
      }

      if (confirmed) {
        blocker.proceed();
      } else {
        blocker.reset();
      }
    };

    void settleBlocker();
  }, [blocker, confirmDiscard]);

  return { confirmDelete, confirmDiscard };
};
