import { ConfirmMessage } from "@/components/confirm-dialog";
import type { ConfirmOptions } from "@/components/confirm-dialog";

export const getDeleteSpamConfirmation = (subject: string): ConfirmOptions => ({
  confirmLabel: "Delete forever",
  confirmVariant: "destructive",
  description: (
    <ConfirmMessage subject={subject}>
      This conversation will be permanently deleted from Gmail. This action
      cannot be undone.
    </ConfirmMessage>
  ),
  title: "Delete conversation?",
});
