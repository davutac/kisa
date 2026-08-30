import { ConfirmMessage } from "@/components/confirm-dialog";
import type { ConfirmOptions } from "@/components/confirm-dialog";

export const getDeleteForeverConfirmation = (
  subject: string
): ConfirmOptions => ({
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

const conversationCount = (count: number): string =>
  `${count} conversation${count === 1 ? "" : "s"}`;

export const getBulkDeleteForeverConfirmation = (
  count: number
): ConfirmOptions => ({
  confirmLabel: "Delete forever",
  confirmVariant: "destructive",
  description: `${conversationCount(count)} will be permanently deleted from Gmail. This action cannot be undone.`,
  title: `Delete ${conversationCount(count)}?`,
});
