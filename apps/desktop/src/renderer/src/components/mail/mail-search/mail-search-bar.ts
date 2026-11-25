import { getMailboxPlaceName } from "@/mail/mailbox-place";
import type { MailboxPlace } from "@/mail/mailbox-place";
import {
  isMailSearchQueryReady,
  toLiveMailSearchQuery,
} from "@/mail/search-query";
import type { SearchQuery } from "@/mail/search-query";

/** The groups the search bar lists, in the order the arrows reach them. */
export type MailSearchBarSection = "clear" | "completions" | "conversations";

export const SHOW_ALL_RESULTS_VALUE = "search:show-all";
export const CLEAR_SEARCH_VALUE = "search:clear";

/** The scope every search adds from the mailbox view, like the result list. */
export interface MailSearchScope {
  readonly mailbox: MailboxPlace;
  readonly unreadOnly: boolean;
}

/** Search covers all non-Spam mail from the Inbox; other places stay put. */
const getMailboxScopeLabel = (mailbox: MailboxPlace): string =>
  mailbox === "inbox" ? "All mail" : getMailboxPlaceName(mailbox);

export const getMailSearchPlaceholder = (mailbox: MailboxPlace): string =>
  `Search ${mailbox === "inbox" ? "all mail" : getMailboxScopeLabel(mailbox)}`;

/**
 * Names the scope the mailbox view adds, which the bar cannot show as pills,
 * so a narrowed search never passes for an empty mailbox.
 */
export const describeMailSearchScope = ({
  mailbox,
  unreadOnly,
}: MailSearchScope): string =>
  [getMailboxScopeLabel(mailbox), unreadOnly ? "unread only" : undefined]
    .filter((part) => part !== undefined)
    .join(" · ");

/** Whether the query asks for something; an empty bar lists filters, not mail. */
export const canSearchFromBar = (query: SearchQuery): boolean => {
  const liveQuery = toLiveMailSearchQuery(query);

  return (
    (liveQuery.filters.length > 0 || liveQuery.text.trim().length > 0) &&
    isMailSearchQueryReady(liveQuery)
  );
};

/**
 * While a filter is being typed its completions lead, so Enter adds the pill.
 * Otherwise the conversations lead, headed by Show all results, so Enter
 * always fills the mailbox list however far the matches below have loaded,
 * and the filter list follows to teach the syntax. Clearing is offered only
 * while the mailbox list shows results.
 */
export const getMailSearchBarSections = ({
  canSearch,
  isDraftingFilter,
  isShowingResults,
}: {
  readonly canSearch: boolean;
  readonly isDraftingFilter: boolean;
  readonly isShowingResults: boolean;
}): readonly MailSearchBarSection[] => {
  const conversations: MailSearchBarSection[] = canSearch
    ? ["conversations"]
    : [];
  const sections: MailSearchBarSection[] = isDraftingFilter
    ? ["completions", ...conversations]
    : [...conversations, "completions"];

  return isShowingResults ? [...sections, "clear"] : sections;
};

/** Keeps the highlighted item while it is still listed, else the first one. */
export const resolveMailSearchBarSelection = (
  selectableValues: readonly string[],
  selection: string
): string =>
  selectableValues.includes(selection)
    ? selection
    : (selectableValues[0] ?? "");
