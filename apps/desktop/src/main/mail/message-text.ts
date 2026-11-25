import { decodeHtmlEntities } from "./html-entities";

const BLOCK_BOUNDARY_PATTERN = /<\/?(?:br|div|li|p|tr|h[1-6])\b[^>]*>/giu;
const TAG_PATTERN = /<[^>]*>/gu;
const WHITESPACE_PATTERN = /\s+/gu;

// Each call returns a new pattern, so its `lastIndex` belongs to one scan.
const createClosingTagPattern = (tag: string): RegExp | undefined => {
  switch (tag) {
    case "script": {
      return /<\/script\s*>/giu;
    }

    case "style": {
      return /<\/style\s*>/giu;
    }

    default: {
      return undefined;
    }
  }
};

/**
 * Replaces each `<script>` and `<style>` element, content included, with a
 * space. A lazy `[\s\S]*?` pattern would rescan the rest of the message for
 * every unclosed opening tag; here a missing closing tag is remembered, since
 * every later opening of the same element is unclosed too.
 */
const removeRawTextElements = (markup: string): string => {
  const opening = /<(?<tag>script|style)\b[^>]*>/giu;
  const unclosed = new Set<string>();
  let text = "";
  let copiedUntil = 0;

  for (
    let open = opening.exec(markup);
    open !== null;
    open = opening.exec(markup)
  ) {
    const tag = open.groups?.tag?.toLowerCase() ?? "";
    const closing = createClosingTagPattern(tag);

    if (closing === undefined || unclosed.has(tag)) {
      continue;
    }

    closing.lastIndex = opening.lastIndex;

    if (closing.exec(markup) === null) {
      unclosed.add(tag);
      continue;
    }

    text += `${markup.slice(copiedUntil, open.index)} `;
    copiedUntil = closing.lastIndex;
    opening.lastIndex = closing.lastIndex;
  }

  return text + markup.slice(copiedUntil);
};

/** Replaces each `<!-- … -->` comment with a space, in one forward pass. */
const removeComments = (markup: string): string => {
  let text = "";
  let copiedUntil = 0;

  for (
    let open = markup.indexOf("<!--");
    open !== -1;
    open = markup.indexOf("<!--", copiedUntil)
  ) {
    const close = markup.indexOf("-->", open + 4);

    // No later comment can close either, so the rest is kept as written.
    if (close === -1) {
      break;
    }

    text += `${markup.slice(copiedUntil, open)} `;
    copiedUntil = close + 3;
  }

  return text + markup.slice(copiedUntil);
};

// Block-level tags become spaces before the other tags are dropped, so
// `<p>one</p><p>two</p>` indexes as two words rather than one token.
const MARKUP_STEPS: readonly ((markup: string) => string)[] = [
  removeRawTextElements,
  removeComments,
  (markup) => markup.replaceAll(BLOCK_BOUNDARY_PATTERN, " "),
  (markup) => markup.replaceAll(TAG_PATTERN, ""),
];

/**
 * Applies a markup step to the text up to its last `>`. Everything a step
 * removes ends with one, so the rest is plain text, and leaving it out keeps
 * each `<` in it from being read to the end of the message once more.
 */
const withinMarkup = (
  text: string,
  step: (markup: string) => string
): string => {
  const markupEnd = text.lastIndexOf(">") + 1;

  return step(text.slice(0, markupEnd)) + text.slice(markupEnd);
};

/**
 * Flattens a message's HTML into the plain text the search index stores.
 *
 * This is deliberately a regex pass rather than a DOM parse: it runs once per
 * message across an entire mailbox, and the output is only ever fed to FTS5 —
 * it is never rendered, so a mangled tag costs a missed token at worst. The
 * renderer keeps showing the original HTML from `body_html`.
 *
 * The HTML is sender-controlled and this runs in Electron main, so every step
 * has to stay linear in its length.
 */
export const toIndexText = (html: string): string => {
  let text = html;

  for (const step of MARKUP_STEPS) {
    text = withinMarkup(text, step);
  }

  return decodeHtmlEntities(text).replaceAll(WHITESPACE_PATTERN, " ").trim();
};
