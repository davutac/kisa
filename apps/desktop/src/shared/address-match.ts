/**
 * How recipient completion matches what was typed against known addresses.
 * Main narrows the cached correspondents with it and the renderer merges
 * those with the conversation's own addresses, so both must rank alike.
 *
 * Matches fall into tiers rather than a continuous score, so that within a
 * tier the caller's order, most-mailed first, decides. Case folds without
 * the user's locale, which would turn a Turkish `I` into `ı`.
 */
const NO_MATCH = 0;
const IN_ORDER = 1;
const CONTAINS = 2;
const WORD_START = 3;
const PREFIX = 4;
const EXACT = 5;

const WORD_SEPARATORS = new Set([" ", "-", ".", "@", "_", "+"]);

interface AddressCandidate {
  readonly address: string;
  readonly name?: string | undefined;
}

const hasLettersInOrder = (text: string, needle: string): boolean => {
  let from = 0;
  for (const character of needle) {
    const found = text.indexOf(character, from);
    if (found === -1) {
      return false;
    }
    from = found + 1;
  }
  return true;
};

const matchText = (text: string, needle: string): number => {
  if (text === needle) {
    return EXACT;
  }
  let index = text.indexOf(needle);
  if (index === 0) {
    return PREFIX;
  }
  if (index > 0) {
    for (; index !== -1; index = text.indexOf(needle, index + 1)) {
      if (WORD_SEPARATORS.has(text.charAt(index - 1))) {
        return WORD_START;
      }
    }
    return CONTAINS;
  }
  return hasLettersInOrder(text, needle) ? IN_ORDER : NO_MATCH;
};

/** Lowercases a draft for {@link isAddressMatch} and {@link rankAddressMatches}. */
export const toAddressQuery = (draft: string): string =>
  draft.trim().toLowerCase();

/**
 * How well an address, or its owner's name, matches a query from
 * {@link toAddressQuery}; `0` is no match. Only an address can match exactly,
 * so typing a full address puts it ahead of a person merely named that way.
 */
const matchAddress = (
  query: string,
  { address, name }: AddressCandidate
): number => {
  if (query.length === 0) {
    return NO_MATCH;
  }
  const byAddress = matchText(address.toLowerCase(), query);
  return name === undefined
    ? byAddress
    : Math.max(
        byAddress,
        Math.min(matchText(name.toLowerCase(), query), PREFIX)
      );
};

export const isAddressMatch = (
  query: string,
  candidate: AddressCandidate
): boolean => matchAddress(query, candidate) !== NO_MATCH;

/** The candidates that match, best tier first, keeping their order within one. */
export const rankAddressMatches = <Candidate extends AddressCandidate>(
  query: string,
  candidates: Iterable<Candidate>
): Candidate[] =>
  [...candidates]
    .map((candidate) => ({ candidate, match: matchAddress(query, candidate) }))
    .filter(({ match }) => match !== NO_MATCH)
    .toSorted((left, right) => right.match - left.match)
    .map(({ candidate }) => candidate);
