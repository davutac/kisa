import type { MailThreadListChange } from "@/shared/ipc/mail";

export type OpenThreadUpdate =
  /** Its messages changed (a reply sent, one arrived or was removed). */
  | { readonly kind: "reread" }
  /** Only its labels moved, such as read state or a label added. */
  | { readonly kind: "labels"; readonly labels: readonly string[] };

/**
 * What an open conversation does with a list update. The update carries the
 * conversation's summary, not its messages, so a changed message count means
 * rereading it from the cache; anything else only moves its labels.
 */
export const toOpenThreadUpdate = (
  changes: readonly MailThreadListChange[],
  open: {
    readonly accountId: string;
    /** Undefined until the conversation has been read once. */
    readonly shownMessageCount: number | undefined;
    readonly threadId: string;
  }
): OpenThreadUpdate | undefined => {
  const summary = changes.findLast(
    (change) =>
      change.kind === "upsert" &&
      change.thread.accountId === open.accountId &&
      change.thread.threadId === open.threadId
  );

  if (summary === undefined || summary.kind !== "upsert") {
    return undefined;
  }

  return open.shownMessageCount !== undefined &&
    summary.thread.messageCount !== open.shownMessageCount
    ? { kind: "reread" }
    : { kind: "labels", labels: summary.thread.labels };
};
