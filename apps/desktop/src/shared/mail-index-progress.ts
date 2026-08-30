interface MailIndexProgressValue {
  readonly estimatedMessages?: number;
  readonly indexedMessages: number;
}

/** Gmail's message total is an estimate, so work is clamped to completion. */
export const toMailIndexRatio = (
  progress: MailIndexProgressValue | undefined
): number | undefined => {
  if (progress === undefined) {
    return undefined;
  }

  const estimate = progress.estimatedMessages;
  return estimate === undefined || estimate <= 0
    ? undefined
    : Math.min(1, progress.indexedMessages / estimate);
};

/** Weight combined progress by message count rather than mailbox count. */
export const toOverallMailIndexRatio = (
  entries: readonly MailIndexProgressValue[]
): number | undefined => {
  if (entries.length === 0) {
    return undefined;
  }

  let estimated = 0;
  let indexed = 0;
  for (const entry of entries) {
    const estimate = entry.estimatedMessages;
    if (estimate === undefined || estimate <= 0) {
      return undefined;
    }
    estimated += estimate;
    indexed += Math.min(entry.indexedMessages, estimate);
  }

  return indexed / estimated;
};
