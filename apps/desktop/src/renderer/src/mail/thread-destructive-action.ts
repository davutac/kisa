import { hasSpamLabel, hasTrashLabel } from "@/mail/label";
import type { GmailThreadSummary } from "@/shared/ipc/mail";

export type ThreadDestructiveAction = "deleteForever" | "trash";

export const getThreadDestructiveAction = (
  labels: readonly string[]
): ThreadDestructiveAction =>
  hasSpamLabel(labels) || hasTrashLabel(labels) ? "deleteForever" : "trash";

export const getBulkThreadDestructiveAction = (
  threads: readonly Pick<GmailThreadSummary, "labels">[]
): ThreadDestructiveAction | undefined => {
  const [first] = threads;
  if (first === undefined) {
    return undefined;
  }

  const action = getThreadDestructiveAction(first.labels);
  return threads.every(
    (thread) => getThreadDestructiveAction(thread.labels) === action
  )
    ? action
    : undefined;
};
