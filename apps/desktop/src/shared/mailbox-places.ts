import { Mailbox } from "./ipc/mail";
import type { MailboxPlace } from "./ipc/mail";

const MAILBOXES: ReadonlySet<MailboxPlace> = new Set(Mailbox.literals);

/** A mailbox, and not a label: asked for every listed row, so by lookup. */
const isMailbox = (place: MailboxPlace): place is Mailbox =>
  MAILBOXES.has(place);

/**
 * Folds a label's case as SQLite's `lower()` does: ASCII letters only. The
 * cache's page query matches a label place that way, so a place's key does
 * too, and "Ärzte" and "ärzte" stay two labels on both sides.
 */
const foldLabel = (label: string): string =>
  label.replaceAll(/[A-Z]/gu, (letter) => letter.toLowerCase());

/**
 * How a place is named in a conversation's `places`. A mailbox is its own
 * key, and a label is tagged, so one called "Trash" is never the Trash
 * mailbox.
 */
export const mailboxPlaceKey = (place: MailboxPlace): string =>
  isMailbox(place) ? place : `label:${foldLabel(place.label)}`;

/** Whether a place is among a conversation's `places`. */
export const isListedIn = (
  places: readonly string[],
  place: MailboxPlace
): boolean => places.includes(mailboxPlaceKey(place));

/** In Spam or Trash: mail on its way out, listed nowhere else. */
export const isDiscarded = (places: readonly string[]): boolean =>
  isListedIn(places, "spam") || isListedIn(places, "trash");

/** What decides where a conversation is listed. */
export interface ListingFacts {
  readonly isInInbox: boolean;
  readonly isInSent: boolean;
  readonly isInSpam: boolean;
  readonly isInTrash: boolean;
  readonly isStarred: boolean;
  /** The user labels it carries, each by its path. */
  readonly userLabels: readonly string[];
}

/**
 * The places that list a conversation, by key. This is the rule, and the
 * only one outside SQL: main sends its answer with every conversation, and a
 * window asks whether a place's key is among them, never working it out
 * from the conversation's labels.
 *
 * Spam and Trash list what they hold. Everywhere else lists a conversation
 * only outside both: the Inbox and Sent by where its mail is, Starred and a
 * label by what it carries, whether or not it is in the Inbox.
 *
 * The cache's page query states the same rule in SQL so a page is an index
 * scan (`mailboxCondition`), and `tests/mail-thread-page.test.ts` holds the
 * two together.
 */
export const listingPlaces = (facts: ListingFacts): readonly string[] => {
  if (facts.isInSpam || facts.isInTrash) {
    return [
      ...(facts.isInSpam ? [mailboxPlaceKey("spam")] : []),
      ...(facts.isInTrash ? [mailboxPlaceKey("trash")] : []),
    ];
  }

  return [
    ...(facts.isInInbox ? [mailboxPlaceKey("inbox")] : []),
    ...(facts.isInSent ? [mailboxPlaceKey("sent")] : []),
    ...(facts.isStarred ? [mailboxPlaceKey("starred")] : []),
    ...new Set(
      facts.userLabels
        .filter((label) => label.length > 0)
        .map((label) => mailboxPlaceKey({ label }))
    ),
  ];
};
