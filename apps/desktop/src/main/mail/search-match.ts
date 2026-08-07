/**
 * Word runs as `unicode61` sees them: it splits on everything that is not a
 * letter or a digit, so `test@gmail.com` is three tokens in the index and has
 * to become three tokens in the query too.
 */
const WORD_PATTERN = /[\p{L}\p{N}]+/gu;

const LIKE_WILDCARD_PATTERN = /[\\%_]/gu;

/**
 * Turns typed text into an FTS5 MATCH expression.
 *
 * Every word run becomes a quoted phrase so punctuation can never be read as
 * FTS5 syntax, and each phrase carries a `*` so the index matches while the
 * word is still being typed — searching for "invoi" finds "invoice". Phrases
 * are separated by a space, which FTS5 reads as AND.
 *
 * Returns `undefined` when nothing tokenizable is left, because an empty MATCH
 * expression is a syntax error rather than a match-everything query.
 */
export const toFtsMatchQuery = (text: string): string | undefined => {
  const phrases = text.split(/\s+/u).flatMap((token) => {
    const words = token.match(WORD_PATTERN) ?? [];

    return words.length === 0 ? [] : [`"${words.join(" ")}"*`];
  });

  return phrases.length === 0 ? undefined : phrases.join(" ");
};

/**
 * A `LIKE ... ESCAPE '\'` pattern that matches the value anywhere. The
 * wildcards a user can type — `%` and `_` — are escaped so `50%` searches for
 * the literal text rather than everything.
 */
export const toContainsPattern = (value: string): string =>
  `%${value.replaceAll(LIKE_WILDCARD_PATTERN, (match) => `\\${match}`)}%`;
