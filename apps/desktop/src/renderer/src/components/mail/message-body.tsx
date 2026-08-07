import { useCallback, useEffect, useMemo, useRef } from "react";

import type { ColorScheme } from "@/components/shell/theme-provider";
import { useTheme } from "@/components/shell/theme-provider";
import { needsLightSurface } from "@/mail/email-surface";
import { blockRemoteImages } from "@/mail/remote-images";
import type { GmailMessageBody } from "@/shared/ipc/mail";

interface MailMessageBodyProps {
  allowRemoteImages: boolean;
  body: GmailMessageBody;
  fallbackText: string;
}

interface EmailDocumentOptions {
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
const EXTERNAL_LINK_PROTOCOLS = new Set(["http:", "https:"]);

const createEmailDocument = (
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
        padding: ${lightSurface ? "12px 16px" : "0 16px"};
        overflow-wrap: anywhere;
        font: 14px/1.55 system-ui, sans-serif;
      }
      img { max-width: 100%; height: auto; }
      pre { overflow: auto; white-space: pre-wrap; }
      table { max-width: 100%; }
      a[href] { color: LinkText; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
    </style>
  </head>
  <body>${html}</body>
</html>`;
};

const resizeEmailFrame = (frame: HTMLIFrameElement): void => {
  const documentElement = frame.contentDocument?.documentElement;
  const body = frame.contentDocument?.body;

  if (documentElement !== undefined && body !== undefined) {
    const contentHeight = Math.max(
      documentElement.scrollHeight,
      documentElement.offsetHeight,
      body.scrollHeight,
      body.offsetHeight
    );

    frame.style.height = `${Math.max(Math.ceil(contentHeight) + 1, 96)}px`;
  }
};

const prepareEmailLinks = (document: Document): void => {
  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    try {
      const url = new URL(link.href);

      if (!EXTERNAL_LINK_PROTOCOLS.has(url.protocol)) {
        link.removeAttribute("href");
        link.removeAttribute("target");
        continue;
      }

      link.href = url.toString();
      link.referrerPolicy = "no-referrer";
      link.rel = "noopener noreferrer";
      link.target = "_blank";
    } catch {
      link.removeAttribute("href");
      link.removeAttribute("target");
    }
  }
};

const MailMessageBody = ({
  allowRemoteImages,
  body,
  fallbackText,
}: MailMessageBodyProps) => {
  const resizeObserver = useRef<ResizeObserver | null>(null);
  const { resolvedTheme } = useTheme();
  const emailDocument = useMemo(
    () =>
      body.html === undefined
        ? undefined
        : createEmailDocument(
            allowRemoteImages ? body.html : blockRemoteImages(body.html).html,
            {
              allowRemoteImages,
              colorScheme: resolvedTheme,
              lightSurface: needsLightSurface(body.html),
            }
          ),
    [allowRemoteImages, body.html, resolvedTheme]
  );
  const prepareEmailFrame = useCallback((frame: HTMLIFrameElement): void => {
    resizeObserver.current?.disconnect();

    const documentElement = frame.contentDocument?.documentElement;
    const frameBody = frame.contentDocument?.body;

    if (documentElement === undefined || frameBody === undefined) {
      return;
    }

    for (const element of [documentElement, frameBody]) {
      element.style.setProperty("height", "auto", "important");
      element.style.setProperty("max-height", "none", "important");
      element.style.setProperty("min-height", "0", "important");
      element.style.setProperty("overflow", "hidden", "important");
    }

    prepareEmailLinks(frameBody.ownerDocument);

    const observer = new ResizeObserver(() => resizeEmailFrame(frame));
    observer.observe(documentElement);
    observer.observe(frameBody);
    resizeObserver.current = observer;
    resizeEmailFrame(frame);
  }, []);

  useEffect(
    () => () => {
      resizeObserver.current?.disconnect();
    },
    []
  );

  if (emailDocument !== undefined) {
    return (
      <iframe
        className="bg-card min-h-24 w-full border-0"
        onLoad={(event) => prepareEmailFrame(event.currentTarget)}
        referrerPolicy="no-referrer"
        sandbox="allow-popups allow-same-origin"
        scrolling="no"
        srcDoc={emailDocument}
        title="Email message content"
      />
    );
  }

  return (
    <div className="bg-card p-4 text-sm leading-relaxed wrap-break-word whitespace-pre-wrap">
      {body.text ?? fallbackText}
    </div>
  );
};

export default MailMessageBody;
