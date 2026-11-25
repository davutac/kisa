import type { MailThreadSummary } from "@/shared/ipc/mail";
import { isDiscarded } from "@/shared/mailbox-places";

export type ThreadDestructiveAction = "deleteForever" | "trash";

/**
 * What Delete does to a conversation: it goes to Trash, or for good once it
 * is in Spam or Trash. Asked of the places main sent, so a folder a server
 * happens to call Trash is never deleted from for good.
 */
export const getThreadDestructiveAction = (
  places: readonly string[]
): ThreadDestructiveAction => (isDiscarded(places) ? "deleteForever" : "trash");

export const getBulkThreadDestructiveAction = (
  threads: readonly Pick<MailThreadSummary, "places">[]
): ThreadDestructiveAction | undefined => {
  const [first] = threads;

  if (first === undefined) {
    return undefined;
  }

  const action = getThreadDestructiveAction(first.places);

  return threads.every(
    (thread) => getThreadDestructiveAction(thread.places) === action
  )
    ? action
    : undefined;
};
