import { CopyIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import type { ColorScheme } from "@/components/shell/theme-provider";
import { useTheme } from "@/components/shell/theme-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
  <body>${html}</body>
</html>`;
};

interface EmailFrameLayoutElement {
  readonly offsetHeight: number;
  readonly scrollHeight: number;
}

interface EmailFrameLayout {
  readonly contentDocument: {
    readonly body: EmailFrameLayoutElement;
    readonly documentElement: EmailFrameLayoutElement;
  } | null;
  readonly style: { height: string };
}

interface EmailFrameText {
  readonly contentDocument: {
    readonly body: { readonly innerText: string };
  } | null;
}

export const resolveMessageBodyCopyText = (
  bodyText: string | undefined,
  frame: EmailFrameText | null,
  fallbackText: string
): string => {
  // `innerText` matches what the user sees; `textContent` includes hidden markup.
  // oxlint-disable-next-line unicorn/prefer-dom-node-text-content
  const renderedText = frame?.contentDocument?.body.innerText;
  return bodyText ?? renderedText ?? fallbackText;
};

export const resizeEmailFrame = (frame: EmailFrameLayout): void => {
  const documentElement = frame.contentDocument?.documentElement;
  const body = frame.contentDocument?.body;

  if (documentElement !== undefined && body !== undefined) {
    // The root document's scroll and offset heights are never smaller than the
    // iframe viewport. Collapse that viewport before measuring so a reflowed
    // message can shrink instead of feeding the previous height back in.
    frame.style.height = "0px";
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
  const emailFrameRef = useRef<HTMLIFrameElement | null>(null);
  const resizeObserver = useRef<ResizeObserver | null>(null);
  const { resolvedTheme } = useTheme();
  const lightSurface = body.html !== undefined && needsLightSurface(body.html);
  const emailDocument = useMemo(
    () =>
      body.html === undefined
        ? undefined
        : createEmailDocument(
            allowRemoteImages ? body.html : blockRemoteImages(body.html).html,
            {
              allowRemoteImages,
              colorScheme: resolvedTheme,
              lightSurface,
            }
          ),
    [allowRemoteImages, body.html, lightSurface, resolvedTheme]
  );
  const copyMessageBody = useCallback(async (): Promise<void> => {
    const text = resolveMessageBodyCopyText(
      body.text,
      emailFrameRef.current,
      fallbackText
    );

    try {
      await navigator.clipboard.writeText(text);
      toast.success("Message copied");
    } catch {
      toast.error("Could not copy message");
    }
  }, [body.text, fallbackText]);
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

  return (
    <div className="bg-card relative min-w-0">
      <Button
        aria-label="Copy message body"
        className={cn(
          "absolute top-2 right-2 z-10",
          lightSurface
            ? "text-black hover:bg-black/10 hover:text-black dark:hover:bg-black/10"
            : "text-muted-foreground"
        )}
        onClick={() => {
          void copyMessageBody();
        }}
        size="icon-sm"
        title="Copy message body"
        type="button"
        variant="ghost"
      >
        <CopyIcon />
      </Button>
      {emailDocument === undefined ? (
        <div className="p-4 pr-12 text-sm leading-relaxed wrap-break-word whitespace-pre-wrap select-text">
          {body.text ?? fallbackText}
        </div>
      ) : (
        <iframe
          className="bg-card min-h-24 w-full border-0"
          onLoad={(event) => prepareEmailFrame(event.currentTarget)}
          ref={emailFrameRef}
          referrerPolicy="no-referrer"
          sandbox="allow-popups allow-same-origin"
          scrolling="no"
          srcDoc={emailDocument}
          title="Email message content"
        />
      )}
    </div>
  );
};

export default MailMessageBody;
