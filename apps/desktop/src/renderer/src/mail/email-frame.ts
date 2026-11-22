// The document a message is displayed in, and what is done to its links once it
// has loaded. Message HTML is hostile input: the frame is sandboxed without
// scripts, and everything here keeps it from reaching the network or leaving
// the frame. Nothing in this module may depend on React, so it can also be
// exercised in a real Chromium frame.

import type { ColorScheme } from "@/components/shell/theme-provider";

export interface EmailDocumentOptions {
  readonly allowRemoteImages: boolean;
  /** The app's theme, which the frame follows in place of the OS setting. */
  readonly colorScheme: ColorScheme;
  /** Whether the message brings colours that only work on a light page. */
  readonly lightSurface: boolean;
}

// Stripping the markup hides the blocked images; this policy is what keeps the
// message from reaching the network behind that. Shown images load over
// HTTPS only: `http:` URLs are upgraded first, so an image on a router or
// another plain-HTTP device on the reader's network cannot be requested.
const createContentSecurityPolicy = (allowRemoteImages: boolean): string =>
  [
    "default-src 'none'",
    "font-src data:",
    "form-action 'none'",
    `img-src data: cid:${allowRemoteImages ? " https:" : ""}`,
    "style-src 'unsafe-inline'",
    "upgrade-insecure-requests",
  ].join("; ");

// The HTML parser only creates one of these elements from its name, in any
// ASCII case, followed by whitespace, `/` or `>`. The alternatives are fixed
// strings, so the scan stays linear in the length of the message.
const ACTIVE_START_TAG_PATTERN = /<(?:iframe|link|meta)(?=[\t\n\f\r />])/giu;

/**
 * Turns every `<link>`, `<meta>` and `<iframe>` in a message into an inert
 * `<param>`. Each of them acts while the message is parsed, which is before
 * anything can be done to the loaded document, and in a way the frame's
 * policy does not govern:
 *
 * - `<link rel="dns-prefetch">` makes Chromium resolve the named host, which
 *   tells the sender's name server when the message was opened. Neither the
 *   policy nor the `x-dns-prefetch-control` meta tag stops that lookup.
 * - `<iframe srcdoc>` is a second document that `frame-src` does not stop and
 *   this module never sees. Its markup arrives entity-encoded inside an
 *   attribute, so a `<link>` in it is not found here and is resolved all the
 *   same, and its links are never prepared.
 * - `<meta name="referrer">` replaces this document's `no-referrer`, since
 *   the last one wins.
 *
 * The tag is renamed, not removed: removing text can join what is left into a
 * new tag (`<<meta>link …>`), and a rename cannot. `<param>` is a void
 * element, so no following content is swallowed, and it does nothing outside
 * an `<object>`, which the policy keeps from loading. Chromium does not
 * render it, so the message is laid out as if the tag were absent, unlike
 * `<wbr>`, which adds an empty line above whatever follows a message's head.
 * What stood inside an `<iframe>` becomes part of the message, under the
 * same rules as the rest of it.
 */
export const neutralizeActiveElements = (html: string): string =>
  html.replaceAll(ACTIVE_START_TAG_PATTERN, "<param");

/**
 * The document a message is shown in. `<base target="_blank">` makes a link
 * the message gave no target open a new window, which main sends to the
 * system browser, from the moment it is parsed. Left to navigate the frame
 * itself, a link clicked before `prepareEmailLinks` has run is refused by the
 * page policy and replaces the message with an error page. Only the first
 * `<base target>` in a document counts, so a message cannot set another.
 */
export const createEmailDocument = (
  html: string,
  { allowRemoteImages, colorScheme, lightSurface }: EmailDocumentOptions
): string => {
  // `Canvas` and `CanvasText` follow whichever scheme is declared here, so the
  // scheme is the only knob: the message either sits on its own light page or
  // blends into the app's.
  const scheme = lightSurface ? "light" : colorScheme;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="${createContentSecurityPolicy(allowRemoteImages)}">
    <meta name="referrer" content="no-referrer">
    <meta name="color-scheme" content="${scheme}">
    <base target="_blank">
    <style>
      :root { color-scheme: ${scheme}; }
      html, body {
        height: auto !important;
        max-height: none !important;
        min-height: 0 !important;
        margin: 0;
        overflow: hidden !important;
        background: ${lightSurface ? "Canvas" : "transparent"};
        color: CanvasText;
      }
      html { padding: 0; }
      body {
        box-sizing: border-box;
        padding: ${lightSurface ? "12px 48px 12px 16px" : "0 48px 0 16px"};
        overflow-wrap: anywhere;
        font: 14px/1.55 system-ui, sans-serif;
      }
      body, body * { user-select: text !important; }
      img { max-width: 100%; height: auto; }
      pre { overflow: auto; white-space: pre-wrap; }
      table { max-width: 100%; }
      a[href] { color: LinkText; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
    </style>
  </head>
  <body>${neutralizeActiveElements(html)}</body>
</html>`;
};

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const EXTERNAL_LINK_PROTOCOLS = new Set(["http:", "https:"]);

const toExternalUrl = (href: string, baseUrl: string): string | undefined => {
  try {
    const url = new URL(href, baseUrl);

    return EXTERNAL_LINK_PROTOCOLS.has(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Sends every web link in a loaded message to a new window, which main opens
 * in the system browser, and disarms every other link. A link left as written
 * navigates the message frame itself, and from Kisa's `file:` page that can
 * load local files or, on Windows, reach a network share.
 *
 * The elements belong to the frame's own window, so they are told apart by
 * namespace: `instanceof` against this window's classes would never match.
 */
export const prepareEmailLinks = (document: Document): void => {
  for (const link of document.querySelectorAll("a, area")) {
    // An SVG link cannot be pointed at a new window, so it loses its target.
    if (link.namespaceURI !== HTML_NAMESPACE) {
      link.removeAttribute("href");
      link.removeAttributeNS(XLINK_NAMESPACE, "href");
      continue;
    }

    const href = link.getAttribute("href");

    if (href === null) {
      continue;
    }

    const url = toExternalUrl(href, document.baseURI);

    if (url === undefined) {
      link.removeAttribute("href");
      link.removeAttribute("target");
      continue;
    }

    // A link is for opening and nothing else: `ping` would report the click to
    // a second host, and `download` turns the click into a download the
    // sandbox refuses, so the link would do nothing.
    link.removeAttribute("download");
    link.removeAttribute("ping");
    link.setAttribute("href", url);
    link.setAttribute("referrerpolicy", "no-referrer");
    link.setAttribute("rel", "noopener noreferrer");
    link.setAttribute("target", "_blank");
  }
};

/**
 * Whether a frame now shows a parsed message other than the document it held
 * when its content was last set.
 *
 * A message is ready to be prepared once it is parsed. The frame's `load`
 * event comes later, after every image, and an image host that answers slowly
 * or never holds it back for as long as it likes.
 */
export const isParsedMessageDocument = (
  current: Pick<Document, "URL" | "readyState"> | null,
  previous: Pick<Document, "URL" | "readyState"> | null
): boolean =>
  current !== null &&
  current !== previous &&
  current.URL === "about:srcdoc" &&
  current.readyState !== "loading";
