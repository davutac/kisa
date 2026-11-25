import { isNewMailDraftEmpty } from "@/mail/mail-draft";
import type { MailDraftInput } from "@/shared/ipc/mail";

/**
 * What leaving the new-email page does. A busy composer finishes first; an
 * empty one just closes; anything written goes to Stash before it closes, so
 * no way out of the composer, including a click in the sidebar, loses it.
 */
export type NewMessageLeave = "close" | "stash" | "wait";

export const getNewMessageLeave = (
  draft: MailDraftInput,
  isBusy: boolean
): NewMessageLeave => {
  if (isBusy) {
    return "wait";
  }

  return isNewMailDraftEmpty(draft) ? "close" : "stash";
};
