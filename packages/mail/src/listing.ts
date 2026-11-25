import { SystemLabel } from "./ids";

interface Labelled {
  readonly labelIds: readonly string[];
}

const isIn = (message: Labelled, label: string): boolean =>
  message.labelIds.includes(label);

/**
 * The messages a conversation is listed by. The list holds one row per
 * conversation, and a row can be in one of Trash, Spam and everywhere else,
 * so when a conversation's messages are split between them, some take no
 * part in its row:
 *
 * - A message in Trash, while another message is outside Trash. Mail that
 *   arrives in a conversation after it was trashed belongs in the Inbox, as
 *   it does in Gmail; listed under Trash it would never be seen.
 * - A message in Spam, while another message is in the Inbox. The same mail,
 *   arriving in a conversation that was reported.
 *
 * A message in Spam otherwise files the whole conversation there: the user's
 * own replies stay in Sent when a conversation is reported, and those must
 * not take it out of Spam.
 *
 * What the rule guarantees is that mail in the Inbox is always listed in the
 * Inbox. `tests/listing.test.ts` checks that for every way a conversation's
 * messages can be spread.
 */
export const listedMessages = <Message extends Labelled>(
  messages: readonly Message[]
): readonly Message[] => {
  const outsideTrash = messages.filter(
    (message) => !isIn(message, SystemLabel.trash)
  );
  if (outsideTrash.length === 0) {
    return messages;
  }
  const outsideSpam = outsideTrash.filter(
    (message) => !isIn(message, SystemLabel.spam)
  );
  return outsideSpam.some((message) => isIn(message, SystemLabel.inbox))
    ? outsideSpam
    : outsideTrash;
};

/** The places a conversation's row files it under. */
export interface ConversationPlaces {
  readonly isInInbox: boolean;
  readonly isInSent: boolean;
  readonly isInSpam: boolean;
  readonly isInTrash: boolean;
}

/** Where a conversation is listed, by the messages it is listed by. */
export const conversationPlaces = (
  messages: readonly Labelled[]
): ConversationPlaces => {
  const labels = new Set(
    listedMessages(messages).flatMap((message) => message.labelIds)
  );
  return {
    isInInbox: labels.has(SystemLabel.inbox),
    isInSent: labels.has(SystemLabel.sent),
    isInSpam: labels.has(SystemLabel.spam),
    isInTrash: labels.has(SystemLabel.trash),
  };
};
