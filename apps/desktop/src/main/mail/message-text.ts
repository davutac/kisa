const SCRIPT_OR_STYLE_PATTERN =
  /<(?<tag>script|style)\b[^>]*>[\s\S]*?<\/\k<tag>\s*>/giu;
const COMMENT_PATTERN = /<!--[\s\S]*?-->/gu;
const BLOCK_BOUNDARY_PATTERN = /<\/?(?:br|div|li|p|tr|h[1-6])\b[^>]*>/giu;
const TAG_PATTERN = /<[^>]*>/gu;
const WHITESPACE_PATTERN = /\s+/gu;

const NAMED_ENTITIES = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["nbsp", " "],
  ["quot", '"'],
]);

const NUMERIC_ENTITY_PATTERN = /&#(?<hex>x?)(?<digits>[0-9a-f]+);/giu;
const NAMED_ENTITY_PATTERN = /&(?<name>[a-z]+);/giu;

const decodeNumericEntity = (match: string, hex: string, digits: string) => {
  const code =
    hex.length > 0 ? Number.parseInt(digits, 16) : Math.trunc(Number(digits));

  return Number.isNaN(code) || code <= 0 || code > 0x10_ff_ff
    ? match
    : String.fromCodePoint(code);
};

const decodeEntities = (value: string): string =>
  value
    .replace(NUMERIC_ENTITY_PATTERN, (match: string, ...groups: unknown[]) => {
      const { digits, hex } = groups.at(-1) as {
        digits: string;
        hex: string;
      };

      return decodeNumericEntity(match, hex, digits);
    })
    .replace(NAMED_ENTITY_PATTERN, (match: string, ...groups: unknown[]) => {
      const { name } = groups.at(-1) as { name: string };

      return NAMED_ENTITIES.get(name.toLowerCase()) ?? match;
    });

/**
 * Flattens a message's HTML into the plain text the search index stores.
 *
 * This is deliberately a regex pass rather than a DOM parse: it runs once per
 * message across an entire mailbox, and the output is only ever fed to FTS5 —
 * it is never rendered, so a mangled tag costs a missed token at worst. The
 * renderer keeps showing the original HTML from `body_html`.
 *
 * Block-level tags become spaces first, so `<p>one</p><p>two</p>` indexes as
 * two words rather than one run-together token.
 */
export const toIndexText = (html: string): string =>
  decodeEntities(
    html
      .replace(SCRIPT_OR_STYLE_PATTERN, " ")
      .replace(COMMENT_PATTERN, " ")
      .replace(BLOCK_BOUNDARY_PATTERN, " ")
      .replace(TAG_PATTERN, "")
  )
    .replace(WHITESPACE_PATTERN, " ")
    .trim();
