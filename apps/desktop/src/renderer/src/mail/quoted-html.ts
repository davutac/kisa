// Splits the earlier messages quoted at the end of an HTML message off it,
// one message per level of quoting, so the conversation can show each in a
// frame of its own.
//
// The message is read in a document `DOMParser` makes. Such a document has no
// window: it runs nothing and loads nothing, so reading a hostile message
// there tells its sender nothing. What is cut from it is HTML again, and is
// shown only through `createEmailDocument`, like any message.
//
// Clients mark their quotes in markup of their own (see
// docs/research/2026-11-27-quoted-replies.md), so the markers come first and
// the text patterns of `quoted-text` only stand in when none is found. A quote
// is cut only when nothing the sender wrote follows it and something does
// precede it; otherwise the message is left as it came.
//
// The parsed document is another realm's, so nodes are told apart by
// `nodeType` and `tagName`, never `instanceof`.

import { neutralizeActiveElements } from "@/mail/email-frame";
import {
  FORWARD_SEPARATOR_IN_TEXT,
  findQuotedTextStart,
  attributionLineCount,
  isHeaderFieldLine,
  isOriginalMessageLine,
  isOutlookFromLine,
  isQuoteHeaderLine,
  MAX_HEADER_FIELDS,
  MAX_QUOTE_DEPTH,
  parseQuoteSender,
  QUOTE_HEADER_LINES,
} from "@/mail/quoted-text";
import type { QuoteSender } from "@/mail/quoted-text";

/** Markers that hold a whole quote: nothing may follow them. */
const CONTAINER_SELECTOR = [
  ".gmail_quote",
  'blockquote[type="cite" i]',
  ".yahoo_quoted",
  '[id*="yahoo_quoted"]',
  "blockquote.iosymail",
  ".protonmail_quote",
  ".zmail_extra",
  ".tutanota_quote",
  "#OLK_SRC_BODY_SECTION",
  '[id$="mail-editor-reference-message-container"]',
].join(",");

/**
 * Markers that open a quote whose original follows as their siblings:
 * Outlook's header block and its marker for where the reply ended. Exchange
 * prefixes ids it rewrites with `x_`, so ids match by suffix.
 */
const START_SELECTOR = '[id$="appendonsend"],[id$="divRplyFwdMsg"]';

/**
 * Thunderbird's attribution. It opens no quote by itself: under it the quote
 * is a blockquote, and the reply may follow that.
 */
const CITE_PREFIX_SELECTOR = ".moz-cite-prefix";

/** Outlook for Windows draws a rule over its header block as a border. */
const OUTLOOK_BORDER_SELECTOR =
  'div[style*="border-top:solid" i],div[style*="border-top: solid" i]';

const MARKER_SELECTOR = `${CONTAINER_SELECTOR},${START_SELECTOR}`;

/**
 * Wrappers that hold an attribution and blockquotes. Someone answering
 * between quoted paragraphs in Gmail splits its blockquote and writes inside
 * the wrapper, between the halves.
 */
const QUOTE_WRAPPER_SELECTOR = "div.gmail_quote,div.protonmail_quote";

const ATTRIBUTION_SELECTOR = ".gmail_attr";

/** A longer message is shown whole rather than read twice. */
const MAX_HTML_LENGTH = 1_000_000;

/** Past this many quotes a message is left as it came. */
const MAX_MARKERS = 50;

/** Past this much text the patterns are not run; markers still are. */
const MAX_TEXT_SCAN_LENGTH = 300_000;

/** Elements whose text is never shown. */
const SILENT_TAGS = new Set([
  "HEAD",
  "LINK",
  "META",
  "NOSCRIPT",
  "SCRIPT",
  "STYLE",
  "TEMPLATE",
  "TITLE",
]);

const MEDIA_TAGS = new Set([
  "CANVAS",
  "EMBED",
  "IMG",
  "OBJECT",
  "PICTURE",
  "SVG",
  "VIDEO",
]);

/** Elements that begin and end a line of text. */
const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "BODY",
  "CENTER",
  "DD",
  "DETAILS",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TD",
  "TH",
  "TR",
  "UL",
]);

/** A cut cannot be made among these elements' children. */
const STRUCTURED_PARENT_TAGS = new Set([
  "COLGROUP",
  "DATALIST",
  "DL",
  "OL",
  "OPTGROUP",
  "SELECT",
  "TABLE",
  "TBODY",
  "TFOOT",
  "THEAD",
  "TR",
  "UL",
]);

/** A quote is not lifted out of the cell or item it sits in. */
const CONTAINING_TAGS = new Set(["BODY", "DD", "LI", "TD", "TH"]);

/** What a forward's header block might be preceded by in the quote's text. */
const FORWARD_PREFIX_LENGTH = 400;

/** An attribution sits in a short element of its own. */
const MAX_ATTRIBUTION_LENGTH = 400;

const isElement = (node: Node): node is Element =>
  node.nodeType === node.ELEMENT_NODE;

const isText = (node: Node): node is Text => node.nodeType === node.TEXT_NODE;

const tagOf = (element: Element): string => element.tagName.toUpperCase();

const isTrackingPixel = (element: Element): boolean => {
  const width = element.getAttribute("width");
  const height = element.getAttribute("height");

  return (width === "0" || width === "1") && (height === "0" || height === "1");
};

/** Whether a node shows the reader anything: text or media. */
const hasVisibleContent = (node: Node): boolean => {
  if (isText(node)) {
    return node.data.trim().length > 0;
  }

  if (!isElement(node) || SILENT_TAGS.has(tagOf(node))) {
    return false;
  }

  if (MEDIA_TAGS.has(tagOf(node))) {
    return !isTrackingPixel(node);
  }

  for (const child of node.childNodes) {
    if (hasVisibleContent(child)) {
      return true;
    }
  }

  return false;
};

const previousOf = (node: Node): Node | null => node.previousSibling;
const nextOf = (node: Node): Node | null => node.nextSibling;

const siblingsShowContent = (
  from: Node | null,
  step: (node: Node) => Node | null
): boolean => {
  for (let node = from; node !== null; node = step(node)) {
    if (hasVisibleContent(node)) {
      return true;
    }
  }

  return false;
};

/** Whether anything visible sits beside a node, at its level or any above. */
const hasContentBeside = (
  node: Node,
  root: Element,
  step: (node: Node) => Node | null
): boolean => {
  for (
    let current: Node | null = node;
    current !== null && current !== root;
    current = current.parentNode
  ) {
    if (siblingsShowContent(step(current), step)) {
      return true;
    }
  }

  return false;
};

interface RenderedLine {
  /** The line's text, with runs of white space collapsed. */
  readonly text: string;
  /** The text node the line begins in, and where in it. */
  readonly node: Text;
  readonly offset: number;
  /** The nearest element that begins and ends lines round it. */
  readonly block: Element;
}

/**
 * An element's text as the lines a reader would see, worked out from its
 * tags: a block element or a `<br>` ends a line, and so does a line break
 * inside `<pre>`. Blank lines are left out. The document is never laid out,
 * so this is the only way to its lines, and it gives the same answer in any
 * window.
 */
const renderedLines = (
  root: Element,
  limit = Number.POSITIVE_INFINITY
): readonly RenderedLine[] => {
  const lines: RenderedLine[] = [];
  let text = "";
  let start: Omit<RenderedLine, "text"> | undefined;

  const endLine = (): void => {
    if (start !== undefined) {
      lines.push({ ...start, text: text.trim() });
    }

    text = "";
    start = undefined;
  };

  const write = (piece: string, node: Text, offset: number, block: Element) => {
    const collapsed = piece.replaceAll(/\s+/gu, " ");

    if (collapsed.trim().length === 0) {
      text += start === undefined ? "" : " ";

      return;
    }

    start ??= { block, node, offset };
    text += collapsed;
  };

  const visit = (node: Node, block: Element, isPreformatted: boolean): void => {
    if (lines.length >= limit) {
      return;
    }

    if (isText(node)) {
      if (!isPreformatted) {
        write(node.data, node, 0, block);

        return;
      }

      let offset = 0;

      for (const piece of node.data.split("\n")) {
        if (offset > 0) {
          endLine();
        }

        write(piece, node, offset, block);
        offset += piece.length + 1;
      }

      return;
    }

    if (!isElement(node) || SILENT_TAGS.has(tagOf(node))) {
      return;
    }

    const tag = tagOf(node);

    if (tag === "BR") {
      endLine();

      return;
    }

    const isBlock = BLOCK_TAGS.has(tag);

    if (isBlock) {
      endLine();
    }

    for (const child of node.childNodes) {
      visit(child, isBlock ? node : block, isPreformatted || tag === "PRE");
    }

    if (isBlock) {
      endLine();
    }
  };

  visit(root, root, false);
  endLine();

  return lines.slice(0, limit);
};

const normalizedText = (node: Node): string =>
  (node.textContent ?? "").replaceAll(/\s+/gu, " ").trim();

const isAttributionText = (node: Node): boolean => {
  const text = normalizedText(node);

  return text.length <= MAX_ATTRIBUTION_LENGTH && isQuoteHeaderLine(text);
};

/**
 * Whether a sibling just above a quote belongs to it: its attribution, a
 * rule, an empty spacer, or Outlook's marker for where the reply ended.
 */
const belongsAbove = (node: Node): boolean => {
  if (!isElement(node)) {
    return !hasVisibleContent(node) || isAttributionText(node);
  }

  const tag = tagOf(node);

  if (
    tag === "BR" ||
    tag === "HR" ||
    node.matches(START_SELECTOR) ||
    node.matches(CITE_PREFIX_SELECTOR)
  ) {
    return true;
  }

  return hasVisibleContent(node)
    ? isAttributionText(node)
    : !MEDIA_TAGS.has(tag);
};

interface QuoteRange {
  readonly first: ChildNode;
  readonly last: ChildNode;
}

/**
 * Widens a quote over the attribution above it, then out of wrappers that
 * hold nothing else, so the cut takes the whole of it.
 */
const widenRange = (
  range: QuoteRange,
  isContainer: boolean,
  root: Element
): QuoteRange => {
  let { first, last } = range;

  for (;;) {
    while (
      first.previousSibling !== null &&
      belongsAbove(first.previousSibling)
    ) {
      first = first.previousSibling;
    }

    const parent = first.parentElement;

    if (
      parent === null ||
      parent === root ||
      CONTAINING_TAGS.has(tagOf(parent)) ||
      siblingsShowContent(first.previousSibling, previousOf) ||
      siblingsShowContent(last.nextSibling, nextOf)
    ) {
      return { first, last };
    }

    // A quote that opens with a header runs to the end, so out of a wrapper
    // it takes in everything after the wrapper too: Outlook for Windows
    // puts the original after the wrapper round its header block.
    first = parent;
    last = isContainer ? parent : (parent.parentNode?.lastChild ?? parent);
  }
};

/** Whether a quote wrapper holds text of the reply's own beside its quotes. */
const holdsReplyText = (wrapper: Element): boolean => {
  if (!wrapper.matches(QUOTE_WRAPPER_SELECTOR)) {
    return false;
  }

  for (const child of wrapper.childNodes) {
    const isQuotePart =
      !hasVisibleContent(child) ||
      isAttributionText(child) ||
      (isElement(child) &&
        (tagOf(child) === "BLOCKQUOTE" || child.matches(ATTRIBUTION_SELECTOR)));

    if (!isQuotePart) {
      return true;
    }
  }

  return false;
};

const textBetween = (root: Element, set: (range: Range) => void): string => {
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  set(range);

  return range.toString();
};

/** A quote range that can be cut where it is, or undefined. */
const cuttableRange = (
  start: ChildNode,
  isContainer: boolean,
  root: Element
): QuoteRange | undefined => {
  if (isContainer && isElement(start) && holdsReplyText(start)) {
    return undefined;
  }

  const range = widenRange(
    {
      first: start,
      last: isContainer ? start : (start.parentNode?.lastChild ?? start),
    },
    isContainer,
    root
  );

  const parent = range.first.parentElement;

  if (
    parent === null ||
    STRUCTURED_PARENT_TAGS.has(tagOf(parent)) ||
    hasContentBeside(range.last, root, nextOf) ||
    !hasContentBeside(range.first, root, previousOf)
  ) {
    return undefined;
  }

  // Neither what the sender wrote above the quote nor the quote's opening may
  // be a forward's header: a forwarded message is the point of the message,
  // not history.
  const above = textBetween(root, (text) => text.setEndBefore(range.first));

  const opening = textBetween(root, (text) => {
    text.setStartBefore(range.first);
    text.setEndAfter(range.last);
  });

  return FORWARD_SEPARATOR_IN_TEXT.test(above) ||
    FORWARD_SEPARATOR_IN_TEXT.test(
      opening.trimStart().slice(0, FORWARD_PREFIX_LENGTH)
    )
    ? undefined
    : range;
};

/** The marker an element sits inside, looking no further out than a root. */
const enclosingMarker = (element: Element, root: Element): Element | null => {
  const marker = element.parentElement?.closest(MARKER_SELECTOR) ?? null;

  return marker !== null && marker !== root && root.contains(marker)
    ? marker
    : null;
};

const markerRanges = function* markerRanges(
  root: Element
): Generator<QuoteRange> {
  let tried = 0;

  for (const marker of root.querySelectorAll(MARKER_SELECTOR)) {
    if (enclosingMarker(marker, root) !== null) {
      continue;
    }

    tried += 1;

    if (tried > MAX_MARKERS) {
      return;
    }

    const range = cuttableRange(
      marker,
      marker.matches(CONTAINER_SELECTOR),
      root
    );

    if (range !== undefined) {
      yield range;
    }
  }

  for (const border of root.querySelectorAll(OUTLOOK_BORDER_SELECTOR)) {
    const [firstLine] = renderedLines(border, 1);

    if (
      enclosingMarker(border, root) !== null ||
      firstLine === undefined ||
      !isOutlookFromLine(firstLine.text)
    ) {
      continue;
    }

    const range = cuttableRange(border, false, root);

    if (range !== undefined) {
      yield range;
    }
  }
};

/**
 * The node a line begins with among its block's children, so everything from
 * it on can be cut. Undefined when the line begins inside an element that
 * also holds what came before it.
 */
const startOfLine = (line: RenderedLine): ChildNode | undefined => {
  let node: ChildNode =
    line.offset > 0 ? line.node.splitText(line.offset) : line.node;

  while (node.parentNode !== line.block) {
    const parent = node.parentElement;

    if (
      parent === null ||
      siblingsShowContent(node.previousSibling, previousOf)
    ) {
      return undefined;
    }

    node = parent;
  }

  return node;
};

const isInBlockquote = (line: RenderedLine, root: Element): boolean => {
  const blockquote = line.block.closest("blockquote");

  return (
    blockquote !== null && blockquote !== root && root.contains(blockquote)
  );
};

/**
 * Whether the lines under a header read as one quote. Where they include
 * blockquotes, text after one is the reply answering between or under them,
 * which the patterns cannot see: they only know `>`.
 */
const isUnbrokenQuote = (
  lines: readonly RenderedLine[],
  root: Element
): boolean => {
  const firstQuoted = lines.findIndex((line) => isInBlockquote(line, root));

  return (
    firstQuoted === -1 ||
    lines.slice(firstQuoted).every((line) => isInBlockquote(line, root))
  );
};

/** A trailing quote that only its text gives away, as the patterns read it. */
const textRange = (root: Element): QuoteRange | undefined => {
  if ((root.textContent ?? "").length > MAX_TEXT_SCAN_LENGTH) {
    return undefined;
  }

  const lines = renderedLines(root);
  const index = findQuotedTextStart(lines.map((line) => line.text));
  const line = index === null ? undefined : lines[index];

  if (
    index === null ||
    line === undefined ||
    !isUnbrokenQuote(lines.slice(index + 1), root)
  ) {
    return undefined;
  }

  const start = startOfLine(line);

  return start === undefined ? undefined : cuttableRange(start, false, root);
};

const findQuoteRange = (root: Element): QuoteRange | undefined => {
  const [range] = markerRanges(root);

  return range ?? textRange(root);
};

const KEEPS_WHITE_SPACE_PATTERN = /white-space\s*:\s*pre/iu;

/** Whether an element shows its text's own line breaks, as `<pre>` does. */
const keepsWhiteSpace = (element: Element): boolean =>
  tagOf(element) === "PRE" ||
  KEEPS_WHITE_SPACE_PATTERN.test(element.getAttribute("style") ?? "");

/**
 * Moves a range out of its document into an element of its own. Text cut
 * out of a `<pre>` goes into a copy of it, or it would lose its lines.
 */
const cut = (range: QuoteRange, document: Document): Element => {
  const container = document.createElement("div");
  const parent = range.first.parentElement;
  let target: Element = container;

  if (parent !== null && keepsWhiteSpace(parent)) {
    target = document.createElement(parent.tagName);

    for (const { name, value } of parent.attributes) {
      target.setAttribute(name, value);
    }

    container.append(target);
  }

  for (let node: ChildNode | null = range.first; node !== null;) {
    const next: ChildNode | null =
      node === range.last ? null : node.nextSibling;

    target.append(node);
    node = next;
  }

  return container;
};

const isQuoteHeaderNode = (node: Node): boolean =>
  isAttributionText(node) ||
  (isElement(node) &&
    (node.matches(ATTRIBUTION_SELECTOR) ||
      node.matches(CITE_PREFIX_SELECTOR) ||
      node.matches(START_SELECTOR)));

/** Empty elements that only space a quote from what is round it. */
const SPACER_TAGS = new Set(["BR", "DIV", "FONT", "HR", "P", "SPAN"]);

const isSpacer = (node: Node): boolean =>
  !hasVisibleContent(node) &&
  (!isElement(node) || SPACER_TAGS.has(tagOf(node)));

interface HeaderProgress {
  /** Whether the whole header is off, so only spacers may still go. */
  isOff: boolean;
  /** How many fields of an Outlook header block are gone so far. */
  fields: number;
  /**
   * Whether a blockquote may still be the quote's own wrapper. Under an
   * Outlook header, or once one is unwrapped, a blockquote is something the
   * quoted message itself quoted.
   */
  mayUnwrap: boolean;
}

/**
 * How many header fields a node holds when it holds nothing else, as the
 * block Outlook writes does: From, Sent, To, Subject.
 */
const headerFieldsIn = (node: Node, header: HeaderProgress): number => {
  const lines = isElement(node)
    ? renderedLines(node, MAX_HEADER_FIELDS + 1).map((line) => line.text)
    : [normalizedText(node)];

  const [firstLine] = lines;

  return firstLine !== undefined &&
    lines.length + header.fields <= MAX_HEADER_FIELDS &&
    lines.every(isHeaderFieldLine) &&
    (header.fields > 0 || isOutlookFromLine(firstLine))
    ? lines.length
    : 0;
};

/**
 * Takes a quote's one header off the top of an element: its attribution, or
 * the fields of an Outlook block up to the blank line that ends them, and
 * the spacers round it. What the quoted message said begins after that, so
 * nothing else goes, not even a line of it that reads like a header. The
 * message's styles stay.
 */
const removeQuoteHeader = (root: Element, header: HeaderProgress): void => {
  // A copy, since the list itself shrinks as children are removed.
  const children = [...root.childNodes];
  let isAfterBreak = false;

  for (const child of children) {
    if (isElement(child) && SILENT_TAGS.has(tagOf(child))) {
      continue;
    }

    if (isSpacer(child)) {
      // One `<br>` only ends a field's line. An empty block, a rule, or a
      // second `<br>` is the blank line under the fields.
      const isBreak = isElement(child) && tagOf(child) === "BR";
      const isBlankLine = isElement(child) && (!isBreak || isAfterBreak);

      header.isOff ||= header.fields > 0 && isBlankLine;
      isAfterBreak = isBreak || (isAfterBreak && !isElement(child));
      child.remove();
      continue;
    }

    if (header.isOff) {
      return;
    }

    isAfterBreak = false;

    if (isElement(child) && child.matches(START_SELECTOR)) {
      // Outlook's block, with every field inside it.
      header.isOff = true;
      header.mayUnwrap = false;
    } else if (isOriginalMessageLine(normalizedText(child))) {
      // A rule over the fields, which follow it.
      header.mayUnwrap = false;
    } else if (isQuoteHeaderNode(child)) {
      header.isOff = true;
    } else {
      const fields = headerFieldsIn(child, header);

      // Not a header. If it is a wrapper round the whole quote, the header
      // is inside it, so the search is not over yet.
      if (fields === 0) {
        return;
      }

      header.fields += fields;
      header.mayUnwrap = false;
    }

    child.remove();
  }
};

/** Puts a plain block where a blockquote was, so its text reads unquoted. */
const withoutQuoteLook = (blockquote: Element): Element => {
  const block = blockquote.ownerDocument.createElement("div");
  const direction = blockquote.getAttribute("dir");

  if (direction !== null) {
    block.setAttribute("dir", direction);
  }

  block.append(...blockquote.childNodes);
  blockquote.replaceWith(block);

  return block;
};

/**
 * Turns a quote into the message it quotes: its header comes off, and the
 * blockquote round what the message said becomes a plain block. Returns the
 * element holding what the message said, where the older message it quotes
 * in turn is looked for.
 */
const unquote = (quote: Element): Element => {
  const header: HeaderProgress = { fields: 0, isOff: false, mayUnwrap: true };
  let root = quote;

  for (;;) {
    removeQuoteHeader(root, header);

    const content = [...root.childNodes].filter((child) =>
      hasVisibleContent(child)
    );

    const [only] = content;

    if (content.length !== 1 || only === undefined || !isElement(only)) {
      return root;
    }

    if (keepsWhiteSpace(only)) {
      if (!header.isOff && header.fields === 0) {
        removeAttributionLines(only);
      }

      return root;
    }

    if (tagOf(only) === "BLOCKQUOTE" && header.mayUnwrap) {
      root = withoutQuoteLook(only);
      header.isOff = true;
      header.mayUnwrap = false;
    } else {
      root = only;
    }
  }
};

/**
 * Takes an attribution off the top of text that no element sets apart, as
 * in a `<pre>`: the lines of it that share one text node with what follows.
 */
const removeAttributionLines = (root: Element): void => {
  const lines = renderedLines(root, 3);

  const count = attributionLineCount(lines.map((line) => line.text));
  const [first] = lines;
  const next = lines[count];

  if (
    count === 0 ||
    first === undefined ||
    next === undefined ||
    lines.slice(0, count + 1).some((line) => line.node !== first.node)
  ) {
    return;
  }

  first.node.deleteData(first.offset, next.offset - first.offset);
};

const QUOTE_MARK_PATTERN = /^\s*>[ \u00A0]?/u;

/**
 * Takes one level of `>` off text that is quoted the plain-text way, when
 * every line of it is.
 */
const removeQuoteMarks = (root: Element): void => {
  if ((root.textContent ?? "").length > MAX_TEXT_SCAN_LENGTH) {
    return;
  }

  const lines = renderedLines(root);

  if (lines.length === 0 || !lines.every((line) => line.text.startsWith(">"))) {
    return;
  }

  // Last line first, so a mark taken out of a text node leaves the offsets
  // of the lines before it in the same node as they were.
  for (const line of lines.toReversed()) {
    const mark = QUOTE_MARK_PATTERN.exec(line.node.data.slice(line.offset));

    if (mark !== null) {
      line.node.deleteData(line.offset, mark[0].length);
    }
  }
};

const escapeAttribute = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

const openTagOf = (element: Element): string =>
  `<${element.tagName.toLowerCase()}${[...element.attributes]
    .map(({ name, value }) => ` ${name}="${escapeAttribute(value)}"`)
    .join("")}>`;

export interface QuotedHtmlMessage {
  /** What the quoted message said, without its header or quote look. */
  readonly html: string;
  readonly sender: QuoteSender;
}

export interface SplitQuotedHtml {
  /** The message without the quotes at its end. */
  readonly html: string;
  /** Each earlier message it quotes, nearest first. */
  readonly quotes: readonly QuotedHtmlMessage[];
  /** The whole message as text, quotes included, one line per line. */
  readonly text: string;
}

/**
 * An HTML message and the chain of messages quoted at its end, or null when
 * it has none to set apart. Each part keeps the message's styles and its
 * `<html>` and `<body>` attributes, which the frame's parser applies again.
 */
export const splitQuotedHtml = (html: string): SplitQuotedHtml | null => {
  if (html.length > MAX_HTML_LENGTH) {
    return null;
  }

  const document = new DOMParser().parseFromString(
    neutralizeActiveElements(html),
    "text/html"
  );

  const { body } = document;

  // The message's styles go to every part. They are taken out of the body
  // as well as the head: renaming a `<meta>` ends the head early, so the
  // styles after it are parsed into the body. They leave before the quote is
  // looked for, so none of them can be the node a quote is cut from.
  const styles = [...document.querySelectorAll("style")].map((style) => {
    style.remove();

    return style.outerHTML;
  });

  const first = findQuoteRange(body);

  if (first === undefined) {
    return null;
  }

  const text = renderedLines(body)
    .map((line) => line.text)
    .join("\n");

  const shell = `${openTagOf(document.documentElement)}${document.head.innerHTML}${styles.join("")}${openTagOf(body)}`;
  const quotes: QuotedHtmlMessage[] = [];
  let quote: Element | undefined = cut(first, document);

  for (let depth = 1; quote !== undefined; depth += 1) {
    const sender = parseQuoteSender(
      renderedLines(quote, QUOTE_HEADER_LINES).map((line) => line.text)
    );

    const content = unquote(quote);
    removeQuoteMarks(content);

    const older = depth < MAX_QUOTE_DEPTH ? findQuoteRange(content) : undefined;

    const next: Element | undefined =
      older === undefined ? undefined : cut(older, document);

    // A quote of a message that said nothing is not worth a chip.
    if (hasVisibleContent(quote)) {
      quotes.push({ html: `${shell}${quote.innerHTML}`, sender });
    }

    quote = next;
  }

  return { html: `${shell}${body.innerHTML}`, quotes, text };
};
