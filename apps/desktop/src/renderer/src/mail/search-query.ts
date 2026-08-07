import type {
  GmailSearchFilter,
  GmailSearchFilterField,
} from "@/shared/ipc/mail";

/**
 * `account` is the one operator the index does not answer: it scopes *which*
 * mailboxes are searched rather than what matches inside them, so it is applied
 * by choosing the accounts in the request. Everything else is sent as a filter.
 */
export type SearchFilterField = GmailSearchFilterField | "account";

export interface SearchFilter {
  field: SearchFilterField;
  value: string;
}

export interface SearchQuery {
  filters: readonly SearchFilter[];
  /** Everything that is not an operator: the words matched against the index. */
  text: string;
}

export const EMPTY_SEARCH_QUERY: SearchQuery = { filters: [], text: "" };

export const SEARCH_FILTER_FIELDS: readonly SearchFilterField[] = [
  "account",
  "from",
  "to",
  "subject",
  "has",
  "is",
];

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

export const parseSearchQuery = (raw: string): SearchQuery => {
  const filters: SearchFilter[] = [];
  const words: string[] = [];

  for (const token of tokenizeQuery(raw)) {
    const filter = toFilter(token.value);

    if (filter === undefined) {
      words.push(token.value);
    } else {
      filters.push(filter);
    }
  }

  return { filters, text: words.join(" ") };
};

const formatFilterValue = (value: string): string =>
  /\s/u.test(value) ? `"${value}"` : value;

export const formatSearchFilter = (filter: SearchFilter): string =>
  `${filter.field}:${formatFilterValue(filter.value)}`;

/**
 * Serialises back to Gmail's own query syntax, so the same string can be handed
 * to Gmail search when the palette hands off to the mailbox list.
 */
export const formatSearchQuery = (query: SearchQuery): string =>
  [...query.filters.map(formatSearchFilter), query.text.trim()]
    .filter((part) => part.length > 0)
    .join(" ");

export const isSearchQueryEmpty = (query: SearchQuery): boolean =>
  query.filters.length === 0 && query.text.trim().length === 0;

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
 * The operator being typed right now, if any — what the palette offers
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

  return FILTER_FIELDS.has(field)
    ? {
        field: field as SearchFilterField,
        value: token.value.slice(separatorIndex + 1),
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

const FILTER_LABELS: Record<SearchFilterField, string> = {
  account: "Account",
  from: "From",
  has: "Has",
  is: "Is",
  subject: "Subject",
  to: "To",
};

export const getSearchFilterLabel = (field: SearchFilterField): string =>
  FILTER_LABELS[field];

/**
 * The accounts an `account:` pill narrows to, matched against the connected
 * ones so a half-typed or stale address cannot silently search nothing. With no
 * pill — or none that names a connected account — every account is searched.
 */
export const getSearchAccountIds = (
  query: SearchQuery,
  accountIds: readonly string[]
): readonly string[] => {
  const wanted = new Set(
    query.filters
      .filter((filter) => filter.field === "account")
      .map((filter) => filter.value.toLowerCase())
  );
  const scoped = accountIds.filter((accountId) =>
    wanted.has(accountId.toLowerCase())
  );

  return scoped.length === 0 ? accountIds : scoped;
};

/** Drops the pills the index does not answer, leaving what the search takes. */
export const toIndexSearchFilters = (
  query: SearchQuery
): readonly GmailSearchFilter[] =>
  query.filters.filter(
    (filter): filter is GmailSearchFilter => filter.field !== "account"
  );
