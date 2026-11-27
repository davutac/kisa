// Most HTML mail is written for a white page: the sender picks dark greys for
// text and leaves the background to the client. Painting that on a dark card
// turns a signature into dark-on-dark, which no amount of theming fixes -- the
// colour was chosen by the sender, not by us. Such a message gets a light
// canvas so it reads the way it was written, and a message that brings no
// colours of its own follows the app's theme instead.

const AUTHOR_COLOR_PATTERN =
  /<font\b|\sbgcolor\s*=|[\s;{"']color\s*:|[\s;{"']background(?:-color)?\s*:/iu;

const DARK_SCHEME_PATTERN = /prefers-color-scheme\s*:\s*dark/iu;

/** Whether a message picks colours of its own, for text or backgrounds. */
export const hasOwnColors = (html: string): boolean =>
  AUTHOR_COLOR_PATTERN.test(html);

/**
 * Whether a message carries a rule for dark mode. That is no promise it reads
 * well on a dark page: the rule often only swaps a logo.
 */
export const hasDarkSchemeRule = (html: string): boolean =>
  DARK_SCHEME_PATTERN.test(html);
