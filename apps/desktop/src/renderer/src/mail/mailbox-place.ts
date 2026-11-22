import { isMailboxLabelPlace } from "@/shared/ipc/mail";
import type {
  Mailbox,
  MailboxLabelPlace,
  MailboxPlace,
} from "@/shared/ipc/mail";

import { normalizeMailboxLabelName } from "./mailbox-labels";

export type { MailboxLabelPlace, MailboxPlace } from "@/shared/ipc/mail";

const MAILBOX_NAMES = {
  inbox: "Inbox",
  sent: "Sent",
  spam: "Spam",
  trash: "Trash",
} as const satisfies Record<Mailbox, string>;

export const isLabelPlace: (place: MailboxPlace) => place is MailboxLabelPlace =
  isMailboxLabelPlace;

/**
 * A place's identity, tagged by kind so a folder called "Sent" never shares
 * a cache entry or history step with the Sent mailbox. Labels compare without
 * regard to case, as the sidebar merges them across accounts.
 */
export const getMailboxPlaceKey = (place: MailboxPlace): string =>
  isLabelPlace(place)
    ? `label:${normalizeMailboxLabelName(place.label)}`
    : `mailbox:${place}`;

export const isSameMailboxPlace = (
  left: MailboxPlace,
  right: MailboxPlace
): boolean => getMailboxPlaceKey(left) === getMailboxPlaceKey(right);

/** What the place is called on screen: a mailbox's name or the label's path. */
export const getMailboxPlaceName = (place: MailboxPlace): string =>
  isLabelPlace(place) ? place.label : MAILBOX_NAMES[place];

/**
 * The search filter value that scopes a search to a label. A user label's id
 * is `u:` and its path (see `docs/architecture/mail-engine.md`), and searching
 * by id keeps a folder named like a mailbox, such as "Spam", from meaning
 * that mailbox, as `label:spam` does.
 */
export const toLabelSearchValue = (label: string): string => `u:${label}`;

/** One step of a place's breadcrumb after its scope. */
export interface MailboxPlaceCrumb {
  readonly name: string;
  /** The parent label choosing the crumb opens; the place opens nothing. */
  readonly place?: MailboxLabelPlace;
}

/**
 * A place's breadcrumb after its scope: a mailbox alone, or a label's path
 * split where its ancestors are labels themselves, the way the sidebar nests
 * them, so `Work/Clients` under a `Work` label reads Work › Clients and each
 * crumb but the last opens its label.
 */
export const getMailboxPlaceCrumbs = (
  place: MailboxPlace,
  labelKeys: ReadonlySet<string>
): readonly MailboxPlaceCrumb[] => {
  if (!isLabelPlace(place)) {
    return [{ name: MAILBOX_NAMES[place] }];
  }

  const segments = place.label.split("/");
  const crumbs: MailboxPlaceCrumb[] = [];
  let start = 0;

  for (let length = 1; length < segments.length; length += 1) {
    const label = segments.slice(0, length).join("/");

    if (labelKeys.has(normalizeMailboxLabelName(label))) {
      crumbs.push({
        name: segments.slice(start, length).join("/"),
        place: { label },
      });
      start = length;
    }
  }

  return [...crumbs, { name: segments.slice(start).join("/") }];
};
