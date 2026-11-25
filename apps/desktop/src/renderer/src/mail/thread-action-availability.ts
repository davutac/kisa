import type { MailThreadSummary, ThreadMessage } from "@/shared/ipc/mail";
import { isDiscarded, isListedIn } from "@/shared/mailbox-places";

import {
  hasInboxLabel,
  hasSentLabel,
  hasSpamLabel,
  hasStarredLabel,
  hasTrashLabel,
} from "./label";

type Labels = readonly string[];
/** A conversation's `places`: where main lists it. */
type Places = readonly string[];

// What a conversation's place allows is asked of the places main sent with
// it, never worked out from its labels. Spam and Trash hold mail on its way
// out, where Archive and Star don't apply.

export const canArchiveThread = (places: Places): boolean =>
  isListedIn(places, "inbox");

export const canStarThread = (places: Places): boolean => !isDiscarded(places);

export const canReportThreadSpam = (places: Places): boolean =>
  !isDiscarded(places);

const isOwnMessage = (labelIds: Labels): boolean =>
  hasSentLabel(labelIds) || labelIds.includes("DRAFT");

/** One message's own labels: in Spam or Trash. */
const isDiscardedMessage = (labelIds: Labels): boolean =>
  hasSpamLabel(labelIds) || hasTrashLabel(labelIds);

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
  places: Places,
  messages: readonly Pick<ThreadMessage, "labelIds">[]
): boolean =>
  !isListedIn(places, "inbox") &&
  !isDiscarded(places) &&
  messages.some(
    ({ labelIds }) =>
      !isOwnMessage(labelIds) &&
      !hasInboxLabel(labelIds) &&
      !isDiscardedMessage(labelIds)
  );

/**
 * What the selection's star control does: star them all, unless every one
 * already has a star, as `Mod+Shift+U` does for read state.
 */
export const getBulkStarTarget = (
  threads: readonly Pick<MailThreadSummary, "labels">[]
): boolean => !threads.every((thread) => hasStarredLabel(thread.labels));
