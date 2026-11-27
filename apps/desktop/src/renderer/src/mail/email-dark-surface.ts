// Shows a message that brings colours of its own on the app's dark card,
// where it would otherwise need a light page (see `email-surface`).
//
// A sender's colours were chosen for a white page. Rather than invert them
// all, which shifts every colour the sender meant, the message is repaired
// where a dark page breaks it: a background that only stood in for the page
// is let go, and text that can no longer be read against what is behind it
// is lightened in its own hue. A highlight, a button, or a coloured band
// keeps its colour, and so does the text on it. Images are never touched.
//
// A message built out of backgrounds, a designed newsletter, is not repaired
// but left on its light page. It is known by coloured bands down much of its
// height, a card on a page of another shade, or a large background image: the repair reads everything first and writes
// only once it has decided, so such a message is handed back as it came.
//
// It runs in the frame's parsed document, from the app's side: the frame
// itself runs no script.

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

interface Rgba extends Rgb {
  readonly a: number;
}

/** The app's dark card, which shows through the frame. */
export const DARK_CANVAS: Rgb = { b: 23, g: 23, r: 23 };

/** What text must reach against its background (WCAG AA for body text). */
const MIN_CONTRAST = 4.5;

/** Past this many elements a message is not read, and stays on a light page. */
const MAX_ELEMENTS = 4000;

/** How much of a message's height its bands, or a card on a page, may cover. */
const MAX_BACKGROUND_COVERAGE = 0.4;

/** A coloured background narrower than this is a detail, not the design. */
const MIN_BAND_WIDTH = 200;

/** A background image at least this large has text or a layout over it. */
const MIN_BACKGROUND_IMAGE_AREA = 2500;

const SURFACE_ATTRIBUTE = "data-kisa-surface";

export type EmailSurface = "dark" | "light";

// Chromium gives every sRGB colour back in one of these two forms, whatever
// the sender wrote. A colour in another space is left alone.
const RGB_PATTERN =
  /^rgba?\(\s*(?<r>[\d.]+)[,\s]+(?<g>[\d.]+)[,\s]+(?<b>[\d.]+)(?:\s*[,/]\s*(?<a>[\d.]+%?))?\s*\)$/u;

export const parseCssColor = (value: string): Rgba | undefined => {
  const groups = RGB_PATTERN.exec(value.trim())?.groups;

  if (groups === undefined) {
    return undefined;
  }

  const alpha = groups.a;

  return {
    a:
      alpha === undefined
        ? 1
        : Number(alpha.replace("%", "")) / (alpha.endsWith("%") ? 100 : 1),
    b: Number(groups.b),
    g: Number(groups.g),
    r: Number(groups.r),
  };
};

const toCssColor = ({ b, g, r }: Rgb): string =>
  `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;

/** One colour laid over another, as a see-through one is painted. */
export const blend = (over: Rgba, under: Rgb): Rgb => ({
  b: over.b * over.a + under.b * (1 - over.a),
  g: over.g * over.a + under.g * (1 - over.a),
  r: over.r * over.a + under.r * (1 - over.a),
});

const linear = (channel: number): number => {
  const value = channel / 255;

  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

const luminance = ({ b, g, r }: Rgb): number =>
  0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

/** The WCAG contrast ratio of two colours, from 1 to 21. */
export const contrast = (one: Rgb, other: Rgb): number => {
  const [darker = 0, lighter = 0] = [luminance(one), luminance(other)].toSorted(
    (left, right) => left - right
  );

  return (lighter + 0.05) / (darker + 0.05);
};

/**
 * Whether a background only stands in for the page: white, or a light grey
 * or cream. Such a background is let go, so the card shows through.
 */
export const isPageLikeBackground = (color: Rgb): boolean =>
  luminance(color) >= 0.7 &&
  Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b) <=
    32;

interface Hsl {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

const toHsl = ({ b, g, r }: Rgb): Hsl => {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  const range = max - min;

  if (range === 0) {
    return { h: 0, l, s: 0 };
  }

  const s = range / (1 - Math.abs(2 * l - 1));
  let h = 0;

  if (max === red) {
    h = ((green - blue) / range) % 6;
  } else if (max === green) {
    h = (blue - red) / range + 2;
  } else {
    h = (red - green) / range + 4;
  }

  return { h: (h * 60 + 360) % 360, l, s };
};

const fromHsl = ({ h, l, s }: Hsl): Rgb => {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const second = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const base = l - chroma / 2;
  const sector = Math.floor(h / 60) % 6;

  const [red = 0, green = 0, blue = 0] =
    [
      [chroma, second, 0],
      [second, chroma, 0],
      [0, chroma, second],
      [0, second, chroma],
      [second, 0, chroma],
      [chroma, 0, second],
    ][sector] ?? [];

  return {
    b: (blue + base) * 255,
    g: (green + base) * 255,
    r: (red + base) * 255,
  };
};

const WHITE: Rgb = { b: 255, g: 255, r: 255 };
const BLACK: Rgb = { b: 0, g: 0, r: 0 };
const LIGHTNESS_STEP = 0.04;

/**
 * A colour for text that cannot be read against its background, or
 * undefined when it can. The hue stays the sender's: the colour's lightness
 * is turned over, so black becomes white and a dark blue a light one, then
 * moved further from the background until the text reads.
 */
export const repairTextColor = (
  color: Rgb,
  background: Rgb
): Rgb | undefined => {
  if (contrast(color, background) >= MIN_CONTRAST) {
    return undefined;
  }

  const lighten = contrast(WHITE, background) >= contrast(BLACK, background);
  const hsl = toHsl(color);
  const turned = fromHsl({ ...hsl, l: 1 - hsl.l });

  const start =
    contrast(turned, background) > contrast(color, background)
      ? toHsl(turned).l
      : hsl.l;

  const step = lighten ? LIGHTNESS_STEP : -LIGHTNESS_STEP;
  let repaired = fromHsl({ ...hsl, l: start });

  for (
    let l = start + step;
    l >= 0 && l <= 1 && contrast(repaired, background) < MIN_CONTRAST;
    l += step
  ) {
    repaired = fromHsl({ ...hsl, l });
  }

  // Past the last step only the end of the scale is left to try.
  return contrast(repaired, background) < MIN_CONTRAST
    ? fromHsl({ ...hsl, l: lighten ? 1 : 0 })
    : repaired;
};

/** What is painted behind an element, and whether the sender chose it. */
interface Backdrop {
  /** Undefined where the colour could not be read, so nothing is judged. */
  readonly color: Rgb | undefined;
  /** Whether it is a background the message keeps, not the app's card. */
  readonly isKept: boolean;
  /** The page-like background let go here or above, if there was one. */
  readonly page: Rgb | undefined;
}

interface Repair {
  readonly element: HTMLElement;
  readonly property: "background-color" | "color";
  readonly value: string;
}

const CANVAS: Backdrop = {
  color: DARK_CANVAS,
  isKept: false,
  page: undefined,
};

const hasOwnText = (element: Element): boolean => {
  for (const child of element.childNodes) {
    if (
      child.nodeType === child.TEXT_NODE &&
      (child.textContent ?? "").trim().length > 0
    ) {
      return true;
    }
  }

  return false;
};

/** How much of a height a set of vertical spans covers, overlaps once. */
export const coveredFraction = (
  spans: readonly (readonly [number, number])[],
  height: number
): number => {
  let covered = 0;
  let end = Number.NEGATIVE_INFINITY;

  for (const [top, bottom] of spans.toSorted(
    (left, right) => left[0] - right[0]
  )) {
    covered += Math.max(0, bottom - Math.max(top, end));
    end = Math.max(end, bottom);
  }

  return height <= 0 ? 0 : covered / height;
};

const isHtmlElement = (element: Element): element is HTMLElement =>
  "style" in element && "innerText" in element;

/** What reading a message has found so far. */
interface Plan {
  readonly repairs: Repair[];
  /** The vertical spans of the coloured backgrounds the message keeps. */
  readonly bands: [number, number][];
  /**
   * The vertical spans of page-like backgrounds that sit on a different
   * page-like one: a white card on a grey page, as a newsletter is laid out.
   */
  readonly cards: [number, number][];
}

/** How far apart two channels may be for two page colours to be one. */
const SAME_PAGE_TOLERANCE = 6;

const isSamePage = (one: Rgb, other: Rgb): boolean =>
  Math.max(
    Math.abs(one.r - other.r),
    Math.abs(one.g - other.g),
    Math.abs(one.b - other.b)
  ) <= SAME_PAGE_TOLERANCE;

/**
 * What an element paints behind its own content, given what its parent
 * does: nothing of its own, a page-like background that is let go, or a
 * colour it keeps. Null when it carries a background image large enough to
 * hold a layout, which settles the message as a designed one.
 */
const backdropOf = (
  element: HTMLElement,
  style: CSSStyleDeclaration,
  parent: Backdrop,
  plan: Plan
): Backdrop | null => {
  const unread: Backdrop = { color: undefined, isKept: true, page: undefined };

  if (style.backgroundImage !== "none") {
    const { height, width } = element.getBoundingClientRect();

    return height * width >= MIN_BACKGROUND_IMAGE_AREA ? null : unread;
  }

  const background = parseCssColor(style.backgroundColor);

  if (background === undefined) {
    return unread;
  }

  if (background.a === 0) {
    return parent;
  }

  const color =
    parent.color === undefined ? undefined : blend(background, parent.color);

  const { bottom, top, width } = element.getBoundingClientRect();
  const isBand = width >= MIN_BAND_WIDTH;

  // Only a background that stands in for the page is let go. A white box
  // on a colour the message keeps is part of its design, and stays.
  if (color !== undefined && !parent.isKept && isPageLikeBackground(color)) {
    plan.repairs.push({
      element,
      property: "background-color",
      value: "transparent",
    });

    if (
      isBand &&
      parent.page !== undefined &&
      !isSamePage(parent.page, color)
    ) {
      plan.cards.push([top, bottom]);
    }

    return { ...parent, page: color };
  }

  if (isBand && !parent.isKept) {
    plan.bands.push([top, bottom]);
  }

  return { color, isKept: true, page: undefined };
};

/**
 * Whether an element's colour is painted: on text of its own, or on the
 * marker of a list item, which takes the item's colour whatever holds its
 * text.
 */
const paintsColor = (element: HTMLElement): boolean =>
  element.tagName.toUpperCase() === "LI" || hasOwnText(element);

/**
 * The colour an element's text is given: one that can be read where its own
 * cannot, or its own again where an element above it was given another.
 * Colour is inherited, so without that a repair above would reach text that
 * needed none, such as dark text on a highlight the message keeps.
 */
const textRepairOf = (
  element: HTMLElement,
  style: CSSStyleDeclaration,
  backdrop: Backdrop,
  inheritsWrittenColor: boolean
): Repair | undefined => {
  if (!paintsColor(element)) {
    return undefined;
  }

  const own = style.color;
  const color = parseCssColor(own);

  const repaired =
    color === undefined || backdrop.color === undefined
      ? undefined
      : repairTextColor(blend(color, backdrop.color), backdrop.color);

  if (repaired !== undefined) {
    return { element, property: "color", value: toCssColor(repaired) };
  }

  return inheritsWrittenColor
    ? { element, property: "color", value: own }
    : undefined;
};

/**
 * Reads a message and works out what a dark page needs changed, or returns
 * undefined for a message that is built out of backgrounds and stays light.
 * Nothing is written here.
 */
const planRepairs = (document: Document): readonly Repair[] | undefined => {
  const view = document.defaultView;
  const { body, documentElement } = document;
  const elements = [documentElement, body, ...body.querySelectorAll("*")];

  if (view === null || elements.length > MAX_ELEMENTS) {
    return undefined;
  }

  const backdrops = new Map<Element, Backdrop>();
  // Whether an element, or one above it, is given a colour.
  const colorWritten = new Map<Element, boolean>();
  const plan: Plan = { bands: [], cards: [], repairs: [] };

  // Parents come before their children, so each element finds what its
  // parent paints already worked out.
  for (const element of elements.filter(isHtmlElement)) {
    const style = view.getComputedStyle(element);
    const above = element.parentElement ?? element;

    const backdrop = backdropOf(
      element,
      style,
      backdrops.get(above) ?? CANVAS,
      plan
    );

    if (backdrop === null) {
      return undefined;
    }

    backdrops.set(element, backdrop);

    const inheritsWrittenColor = colorWritten.get(above) ?? false;
    const repair = textRepairOf(element, style, backdrop, inheritsWrittenColor);

    colorWritten.set(element, inheritsWrittenColor || repair !== undefined);

    if (repair !== undefined) {
      plan.repairs.push(repair);
    }
  }

  // A message is built out of backgrounds, and stays on its light page, when
  // coloured bands or a card on a page of another shade run down much of it.
  const { height } = body.getBoundingClientRect();

  return [plan.bands, plan.cards].some(
    (spans) => coveredFraction(spans, height) >= MAX_BACKGROUND_COVERAGE
  )
    ? undefined
    : plan.repairs;
};

/**
 * Settles which page a message with colours of its own is shown on while
 * the app is dark, once per document: repaired for the dark card, or, when
 * it is built out of backgrounds, switched to the light page it was written
 * for. Preparing a document twice gives the first answer again.
 */
export const adaptToDarkSurface = (document: Document): EmailSurface => {
  const root = document.documentElement;
  const settled = root.getAttribute(SURFACE_ATTRIBUTE);

  if (settled === "dark" || settled === "light") {
    return settled;
  }

  const repairs = planRepairs(document);
  const surface: EmailSurface = repairs === undefined ? "light" : "dark";

  for (const { element, property, value } of repairs ?? []) {
    element.style.setProperty(property, value, "important");
  }

  root.setAttribute(SURFACE_ATTRIBUTE, surface);

  if (surface === "light") {
    document
      .querySelector('meta[name="color-scheme"]')
      ?.setAttribute("content", "light");
  }

  return surface;
};
