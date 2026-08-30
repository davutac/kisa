import type { GmailIndexProgress } from "../../shared/ipc/mail";
import { toOverallMailIndexRatio } from "../../shared/mail-index-progress";

export const HIDDEN_MAIL_INDEX_PROGRESS = -1;
export const INDETERMINATE_MAIL_INDEX_PROGRESS = 2;

const isActive = (progress: GmailIndexProgress): boolean =>
  progress.status === "running";

/**
 * Converts per-account indexing progress into Electron's single application
 * progress value. Active accounts are weighted by their estimated message
 * totals so a small mailbox does not count as much as a large one.
 */
export const getNativeMailIndexProgress = (
  progress: readonly GmailIndexProgress[]
): number => {
  const active = progress.filter(isActive);

  if (active.length === 0) {
    return HIDDEN_MAIL_INDEX_PROGRESS;
  }

  return toOverallMailIndexRatio(active) ?? INDETERMINATE_MAIL_INDEX_PROGRESS;
};
