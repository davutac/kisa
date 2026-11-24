import type { MailThreadSummary, ThreadMessage } from "@/shared/ipc/mail";

import {
  hasInboxLabel,
  hasSentLabel,
  hasSpamLabel,
  hasStarredLabel,
  hasTrashLabel,
} from "./label";

type Labels = readonly string[];

/** Spam and Trash hold mail on its way out, where Archive and Star don't apply. */
const isDiscarded = (labels: Labels): boolean =>
  hasSpamLabel(labels) || hasTrashLabel(labels);

export const canArchiveThread = (labels: Labels): boolean =>
  hasInboxLabel(labels) && !isDiscarded(labels);

export const canStarThread = (labels: Labels): boolean => !isDiscarded(labels);

export const canReportThreadSpam = (labels: Labels): boolean =>
  !isDiscarded(labels);

const isOwnMessage = (labelIds: Labels): boolean =>
  hasSentLabel(labelIds) || labelIds.includes("DRAFT");

/**
 * Spam is a verdict on other people's mail: a conversation of only the user's
 * own messages has nothing to report, and main leaves their copies alone.
 */
export const hasReceivedMessage = (
  messages: readonly Pick<ThreadMessage, "labelIds">[]
): boolean => messages.some(({ labelIds }) => !isOwnMessage(labelIds));

/**
 * Whether Move to Inbox has something to bring back: a message the user
 * received that is in none of Inbox, Spam or Trash. A conversation of only
 * their own sent mail has none, so it is never offered there.
 */
export const hasArchivedMessage = (
  labels: Labels,
  messages: readonly Pick<ThreadMessage, "labelIds">[]
): boolean =>
  !hasInboxLabel(labels) &&
  !isDiscarded(labels) &&
  messages.some(
    ({ labelIds }) =>
      !isOwnMessage(labelIds) &&
      !hasInboxLabel(labelIds) &&
      !isDiscarded(labelIds)
  );

/**
 * What the selection's star control does: star them all, unless every one
 * already has a star, as `Mod+Shift+U` does for read state.
 */
export const getBulkStarTarget = (
  threads: readonly Pick<MailThreadSummary, "labels">[]
): boolean => !threads.every((thread) => hasStarredLabel(thread.labels));
