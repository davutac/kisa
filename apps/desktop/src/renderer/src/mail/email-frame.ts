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
// message from reaching the network behind that.
const createContentSecurityPolicy = (allowRemoteImages: boolean): string =>
  [
    "default-src 'none'",
    "font-src data:",
    "form-action 'none'",
    `img-src data: cid:${allowRemoteImages ? " https: http:" : ""}`,
    "style-src 'unsafe-inline'",
  ].join("; ");

// The HTML parser only creates a `<link>` element from these characters, in
// any ASCII case, followed by whitespace, `/` or `>`.
const LINK_START_TAG_PATTERN = /<link(?=[\t\n\f\r />])/giu;

/**
 * Turns every `<link>` in a message into an inert `<wbr>`.
 *
 * The frame's policy stops a link element from fetching anything, but Chromium
 * still resolves the host named by `rel="dns-prefetch"`, which tells the
 * sender's name server when the message was opened. Neither the policy nor the
 * `x-dns-prefetch-control` meta tag stops that lookup, so the element must not
 * exist. `<wbr>` is a void element with no attributes of its own, so the link's
 * attributes do nothing and no following content is swallowed.
 */
export const neutralizeLinkElements = (html: string): string =>
  html.replaceAll(LINK_START_TAG_PATTERN, "<wbr");

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
  <body>${neutralizeLinkElements(html)}</body>
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

    link.setAttribute("href", url);
    link.setAttribute("referrerpolicy", "no-referrer");
    link.setAttribute("rel", "noopener noreferrer");
    link.setAttribute("target", "_blank");
  }
};
