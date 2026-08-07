// Most HTML mail is written for a white page: the sender picks dark greys for
// text and leaves the background to the client. Painting that on a dark card
// turns a signature into dark-on-dark, which no amount of theming fixes -- the
// colour was chosen by the sender, not by us. Such a message gets a light
// canvas so it reads the way it was written, and a message that brings no
// colours of its own follows the app's theme instead.

const AUTHOR_COLOR_PATTERN =
  /<font\b|\sbgcolor\s*=|[\s;{"']color\s*:|[\s;{"']background(?:-color)?\s*:/iu;
// A sender who wrote a dark-mode rule has thought about both schemes already,
// so forcing a light canvas would override the work rather than rescue it.
const DARK_SCHEME_PATTERN = /prefers-color-scheme\s*:\s*dark/iu;

export const needsLightSurface = (html: string): boolean =>
  !DARK_SCHEME_PATTERN.test(html) && AUTHOR_COLOR_PATTERN.test(html);
