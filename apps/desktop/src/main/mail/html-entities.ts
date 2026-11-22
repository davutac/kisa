const NAMED_ENTITIES = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["nbsp", " "],
  ["quot", '"'],
]);

// One pass over every form, so a decoded character is never read again as
// the start of another entity: `&#38;lt;` is the text `&lt;`, not `<`.
const ENTITY_PATTERN =
  /&(?:#x(?<hexDigits>[0-9a-f]+)|#(?<decimalDigits>[0-9]+)|(?<name>[a-z]+));/giu;

// Zero, surrogate halves, and values past Unicode are not characters.
const isCharacterCodePoint = (code: number): boolean =>
  code > 0 && code <= 0x10_ff_ff && (code < 0xd8_00 || code > 0xdf_ff);

/** Decodes numeric and common named HTML entities; others stay as written. */
export const decodeHtmlEntities = (value: string): string =>
  value.replaceAll(ENTITY_PATTERN, (match: string, ...groups: unknown[]) => {
    const { decimalDigits, hexDigits, name } = groups.at(-1) as {
      decimalDigits?: string;
      hexDigits?: string;
      name?: string;
    };

    if (name !== undefined) {
      return NAMED_ENTITIES.get(name.toLowerCase()) ?? match;
    }

    const code =
      hexDigits === undefined
        ? Number(decimalDigits ?? "")
        : Number.parseInt(hexDigits, 16);

    return isCharacterCodePoint(code) ? String.fromCodePoint(code) : match;
  });
