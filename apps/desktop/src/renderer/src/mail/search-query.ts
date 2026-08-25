import type { GmailMailbox, GmailSearchFilterField } from "@/shared/ipc/mail";

export type SearchFilterField = GmailSearchFilterField;

export interface SearchFilter {
  field: SearchFilterField;
  value: string;
}

export interface SearchQuery {
  filters: readonly SearchFilter[];
  /** Everything that is not an operator: the words matched against the index. */
  text: string;
}

export const MIN_SEARCH_TEXT_LENGTH = 2;

/** Filter-only and broad searches run immediately; free text needs two letters. */
export const isMailSearchQueryReady = (query: SearchQuery): boolean => {
  const text = query.text.trim();
  return text.length === 0 || text.length >= MIN_SEARCH_TEXT_LENGTH;
};

/** Search has no hidden Inbox scope: edited queries cover all non-Spam mail. */
export const createMailSearchQuery = (): SearchQuery => ({
  filters: [],
  text: "",
});

export const SEARCH_FILTER_FIELDS = [
  "from",
  "to",
  "subject",
  "has",
] as const satisfies readonly SearchFilterField[];

const FILTER_FIELDS = new Set<string>(SEARCH_FILTER_FIELDS);

interface RawToken {
  /** Index just past the token, so a caller can tell "typed" from "finished". */
  end: number;
  value: string;
}

/**
 * Splits on whitespace, except inside quotes: `from:"Jane Doe"` is one token.
 * An unterminated quote runs to the end of the input, because it is what a
 * half-typed value looks like.
 */
const tokenizeQuery = (raw: string): readonly RawToken[] => {
  const tokens: RawToken[] = [];
  let value = "";
  let isQuoted = false;

  const flush = (end: number): void => {
    if (value.length > 0) {
      tokens.push({ end, value });
      value = "";
    }
  };

  for (const [index, character] of [...raw].entries()) {
    if (character === '"') {
      isQuoted = !isQuoted;
      continue;
    }

    if (!isQuoted && /\s/u.test(character)) {
      flush(index);
      continue;
    }

    value += character;
  }

  flush(raw.length);
  return tokens;
};

const toFilter = (token: string): SearchFilter | undefined => {
  const separatorIndex = token.indexOf(":");

  if (separatorIndex <= 0) {
    return undefined;
  }

  const field = token.slice(0, separatorIndex).toLowerCase();
  const value = token.slice(separatorIndex + 1).trim();
  return FILTER_FIELDS.has(field) && value.length > 0
    ? { field: field as SearchFilterField, value }
    : undefined;
};

const formatFilterValue = (value: string): string =>
  /\s/u.test(value) ? `"${value}"` : value;

export const formatSearchFilter = (filter: SearchFilter): string =>
  `${filter.field}:${formatFilterValue(filter.value)}`;

/**
 * Serialises back to Gmail's own query syntax, so the same string can be handed
 * to Gmail search when the inline field hands off to the mailbox list.
 */
export const formatSearchQuery = (query: SearchQuery): string =>
  [...query.filters.map(formatSearchFilter), query.text.trim()]
    .filter((part) => part.length > 0)
    .join(" ");

const isSameFilter = (left: SearchFilter, right: SearchFilter): boolean =>
  left.field === right.field &&
  left.value.toLowerCase() === right.value.toLowerCase();

export const addSearchFilter = (
  query: SearchQuery,
  filter: SearchFilter
): SearchQuery =>
  query.filters.some((existing) => isSameFilter(existing, filter))
    ? query
    : { ...query, filters: [...query.filters, filter] };

export const addSearchFilters = (
  query: SearchQuery,
  filters: readonly SearchFilter[]
): SearchQuery => {
  let next = query;

  for (const filter of filters) {
    next = addSearchFilter(next, filter);
  }

  return next;
};

export const applyExternalMailSearchScope = (
  query: SearchQuery,
  {
    labelNames,
    mailbox,
    unreadOnly,
  }: {
    readonly labelNames: readonly string[];
    readonly mailbox: GmailMailbox;
    readonly unreadOnly: boolean;
  }
): SearchQuery => {
  const scopeFilters: SearchFilter[] = labelNames.map((value) => ({
    field: "label",
    value,
  }));

  if (mailbox === "spam") {
    scopeFilters.push({ field: "label", value: "spam" });
  }
  if (unreadOnly) {
    scopeFilters.push({ field: "is", value: "unread" });
  }

  return addSearchFilters(query, scopeFilters);
};

export const removeSearchFilterAt = (
  query: SearchQuery,
  index: number
): SearchQuery => ({
  ...query,
  filters: query.filters.filter((_, position) => position !== index),
});

export interface DraftExtraction {
  /** What stays in the input: free text plus the operator still being typed. */
  draft: string;
  filters: readonly SearchFilter[];
}

/**
 * Pulls finished operators out of the input so they can become pills.
 *
 * A token only counts as finished once something follows it — typing `from:a`
 * must not become a pill on the `a`, or the address could never be completed.
 * The draft is only rewritten when a pill is actually taken, leaving ordinary
 * typing (including trailing spaces) exactly as the user left it.
 */
export const extractSearchFilters = (draft: string): DraftExtraction => {
  const tokens = tokenizeQuery(draft);
  const filters: SearchFilter[] = [];
  const rest: string[] = [];

  for (const token of tokens) {
    const filter = token.end < draft.length ? toFilter(token.value) : undefined;

    if (filter === undefined) {
      rest.push(token.value);
    } else {
      filters.push(filter);
    }
  }

  if (filters.length === 0) {
    return { draft, filters };
  }

  const endsWithSpace = /\s$/u.test(draft);

  return {
    draft:
      rest.length === 0 ? "" : `${rest.join(" ")}${endsWithSpace ? " " : ""}`,
    filters,
  };
};

export interface FilterDraft {
  field: SearchFilterField;
  /** The part after the colon, which may still be empty. */
  value: string;
}

/**
 * The operator being typed right now, if any — what the completion menu offers
 * completions for. Only the last token counts: earlier ones are pills already.
 */
export const parseFilterDraft = (draft: string): FilterDraft | undefined => {
  const token = tokenizeQuery(draft).at(-1);

  if (token === undefined || token.end < draft.length) {
    return undefined;
  }

  const separatorIndex = token.value.indexOf(":");

  if (separatorIndex <= 0) {
    return undefined;
  }

  const field = token.value.slice(0, separatorIndex).toLowerCase();
  const value = token.value.slice(separatorIndex + 1);

  return FILTER_FIELDS.has(field)
    ? {
        field: field as SearchFilterField,
        value,
      }
    : undefined;
};

/** Replaces the operator being typed with nothing, once it has become a pill. */
export const removeFilterDraft = (draft: string): string => {
  const tokens = tokenizeQuery(draft);
  const last = tokens.at(-1);

  if (last === undefined) {
    return draft;
  }

  const rest = tokens.slice(0, -1).map((token) => token.value);

  return rest.length === 0 ? "" : `${rest.join(" ")} `;
};

export const toMailSearchDraftFilter = (
  draft: FilterDraft | undefined
): SearchFilter | undefined =>
  draft === undefined || draft.value.trim().length === 0
    ? undefined
    : { field: draft.field, value: draft.value.trim() };

export const toLiveMailSearchQuery = (query: SearchQuery): SearchQuery => {
  const draft = parseFilterDraft(query.text);
  const filter = toMailSearchDraftFilter(draft);

  return draft === undefined
    ? query
    : {
        ...(filter === undefined ? query : addSearchFilter(query, filter)),
        text: removeFilterDraft(query.text),
      };
};

const FILTER_LABELS = {
  from: "From",
  has: "Has",
  is: "Is",
  label: "Label",
  subject: "Subject",
  to: "To",
} satisfies Record<SearchFilterField, string>;

export const getSearchFilterLabel = (field: SearchFilterField): string =>
  FILTER_LABELS[field];
