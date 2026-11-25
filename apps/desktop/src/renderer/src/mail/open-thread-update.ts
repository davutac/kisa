import type { MailThreadListChange, MailThreadReply } from "@/shared/ipc/mail";

export type OpenThreadUpdate =
  /** Its messages changed (a reply sent, one arrived or was removed). */
  | { readonly kind: "reread" }
  /** Only its labels moved, such as read state or a label added. */
  | {
      readonly kind: "labels";
      readonly labels: readonly string[];
      /** Where it is listed now, as main sent it with the labels. */
      readonly places: readonly string[];
    };

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
    : {
        kind: "labels",
        labels: summary.thread.labels,
        places: summary.thread.places,
      };
};

/**
 * Reads an open conversation in two steps. The cache's answer shows at once;
 * when it says the server still owes something, inline images or marking it
 * read, a full load follows and replaces it. The full load runs even once the
 * conversation is no longer shown: it was opened, so it is marked read.
 */
export const loadOpenThread = async ({
  isShown,
  read,
  show,
}: {
  readonly isShown: () => boolean;
  /** Never rejects; a failed read is a failed reply. */
  readonly read: (cachedOnly: boolean) => Promise<MailThreadReply>;
  readonly show: (reply: MailThreadReply) => void;
}): Promise<void> => {
  const cached = await read(true);

  if (isShown()) {
    show(cached);
  }

  if (!(cached.ok && cached.data.awaitsServer)) {
    return;
  }

  const full = await read(false);

  if (isShown()) {
    show(full);
  }
};
