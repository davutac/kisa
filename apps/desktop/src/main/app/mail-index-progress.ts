import type { GmailIndexProgress } from "../../shared/ipc/mail";

export const HIDDEN_MAIL_INDEX_PROGRESS = -1;
export const INDETERMINATE_MAIL_INDEX_PROGRESS = 2;

const isActive = (progress: GmailIndexProgress): boolean =>
  progress.status === "running";

/**
 * Converts per-account indexing progress into Electron's single application
 * progress value. Active accounts are weighted by their estimated thread
 * totals so a small mailbox does not count as much as a large one.
 */
export const getNativeMailIndexProgress = (
  progress: readonly GmailIndexProgress[]
): number => {
  const active = progress.filter(isActive);

  if (active.length === 0) {
    return HIDDEN_MAIL_INDEX_PROGRESS;
  }

  if (
    active.some(
      ({ estimatedThreads }) =>
        estimatedThreads === undefined || estimatedThreads <= 0
    )
  ) {
    return INDETERMINATE_MAIL_INDEX_PROGRESS;
  }

  let estimatedThreads = 0;
  let indexedThreads = 0;

  for (const account of active) {
    const estimate = account.estimatedThreads as number;

    estimatedThreads += estimate;
    indexedThreads += Math.min(account.indexedThreads, estimate);
  }

  return indexedThreads / estimatedThreads;
};
