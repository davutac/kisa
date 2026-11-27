import { CopyIcon, MoonIcon, SunIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useTheme } from "@/components/shell/theme-provider";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { adaptToDarkSurface } from "@/mail/email-dark-surface";
import {
  createEmailDocument,
  isParsedMessageDocument,
  prepareEmailLinks,
} from "@/mail/email-frame";
import {
  hasDarkSchemeRule,
  hasOwnColors as htmlHasOwnColors,
} from "@/mail/email-surface";
import { blockRemoteImages } from "@/mail/remote-images";
import type { MessageBody } from "@/shared/ipc/mail";

interface MailMessageBodyProps {
  allowRemoteImages: boolean;
  body: MessageBody;
  /**
   * What copying the message copies, where the body shown is only part of
   * it: a message whose quoted earlier messages are shown beside it.
   */
  copyText?: string;
  fallbackText: string;
  // Called when the user presses in the sender's document, whose events never
  // reach the app's own.
  onFramePointerDown?: () => void;
}

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

const MailMessageBody = ({
  allowRemoteImages,
  body,
  copyText,
  fallbackText,
  onFramePointerDown,
}: MailMessageBodyProps) => {
  const emailFrameRef = useRef<HTMLIFrameElement | null>(null);
  const onPointerDownRef = useRef(onFramePointerDown);
  const resizeObserver = useRef<ResizeObserver | null>(null);
  const { resolvedTheme } = useTheme();
  const hasOwnColors = body.html !== undefined && htmlHasOwnColors(body.html);

  // A message with a dark-mode rule of its own is not given a light page
  // unless the reader asks: it may already be dressed for a dark one.
  const hasDarkRule = body.html !== undefined && hasDarkSchemeRule(body.html);
  // The reader's choice to see this message as its sender coloured it.
  const [showsOwnColors, setShowsOwnColors] = useState(false);
  // The document that turned out to be built out of backgrounds, if any.
  const [lightDocument, setLightDocument] = useState<string | null>(null);

  // On the dark card a message with colours of its own is repaired for it
  // instead of being given a light page, unless the reader asks otherwise.
  const adaptsToDark =
    hasOwnColors && resolvedTheme === "dark" && !showsOwnColors;

  // The light page a message with colours of its own is given from the
  // start, when it is not repaired for the dark card instead.
  const hasLightPage = hasOwnColors && (showsOwnColors || !hasDarkRule);

  const emailDocument = useMemo(
    () =>
      body.html === undefined
        ? undefined
        : createEmailDocument(
            allowRemoteImages ? body.html : blockRemoteImages(body.html).html,
            {
              allowRemoteImages,
              colorScheme: resolvedTheme,
              lightSurface: !adaptsToDark && hasLightPage,
            }
          ),
    [adaptsToDark, allowRemoteImages, body.html, hasLightPage, resolvedTheme]
  );

  // Whether the message sits on a light page: the one it was given from the
  // start, or the one a repair that gave up switched it to.
  const lightSurface = adaptsToDark
    ? emailDocument !== undefined && lightDocument === emailDocument
    : hasLightPage;

  // Offered while the choice changes anything: not for a message that stays
  // on its light page either way.
  const canChooseColors =
    hasOwnColors &&
    resolvedTheme === "dark" &&
    (showsOwnColors || !lightSurface);

  const colorsLabel = showsOwnColors
    ? "Adapt colors to dark mode"
    : "Show original colors";

  const copyMessageBody = useCallback(async (): Promise<void> => {
    const text = resolveMessageBodyCopyText(
      copyText ?? body.text,
      emailFrameRef.current,
      fallbackText
    );

    try {
      await navigator.clipboard.writeText(text);
      toast.success("Message copied");
    } catch {
      toast.error("Could not copy message");
    }
  }, [body.text, copyText, fallbackText]);

  useEffect(() => {
    onPointerDownRef.current = onFramePointerDown;
  }, [onFramePointerDown]);

  // One listener for every document the frame holds: preparing a document
  // twice adds it once, and a replaced document drops it along with itself.
  const handleFramePointerDown = useCallback((): void => {
    onPointerDownRef.current?.();
  }, []);

  const prepareEmailFrame = useCallback(
    (frame: HTMLIFrameElement): void => {
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

      if (
        adaptsToDark &&
        emailDocument !== undefined &&
        adaptToDarkSurface(
          frameBody.ownerDocument,
          hasDarkRule ? "dark" : "light"
        ) === "light"
      ) {
        setLightDocument(emailDocument);
      }

      frameBody.ownerDocument.addEventListener(
        "pointerdown",
        handleFramePointerDown
      );

      const observer = new ResizeObserver(() => resizeEmailFrame(frame));
      observer.observe(documentElement);
      observer.observe(frameBody);
      resizeObserver.current = observer;
      resizeEmailFrame(frame);
    },
    [adaptsToDark, emailDocument, handleFramePointerDown, hasDarkRule]
  );

  // The frame's load event waits for every image, and a host that answers
  // slowly or never holds it back. Until the message is prepared it stays at
  // its minimum height and its links are as the sender wrote them, so it is
  // prepared as soon as it is parsed and again when it has loaded. Setting
  // the frame's content starts a navigation that cannot finish within this
  // layout effect, so the document seen here is always the one being
  // replaced.
  useLayoutEffect(() => {
    const frame = emailFrameRef.current;

    if (frame === null || emailDocument === undefined) {
      return;
    }

    const previous = frame.contentDocument;

    let request = requestAnimationFrame(function prepareWhenParsed() {
      if (isParsedMessageDocument(frame.contentDocument, previous)) {
        prepareEmailFrame(frame);

        return;
      }

      request = requestAnimationFrame(prepareWhenParsed);
    });

    return () => {
      cancelAnimationFrame(request);
    };
  }, [emailDocument, prepareEmailFrame]);

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
      {canChooseColors ? (
        <Button
          aria-label={colorsLabel}
          className={cn(
            "absolute top-9 right-2 z-10",
            lightSurface
              ? "text-black hover:bg-black/10 hover:text-black dark:hover:bg-black/10"
              : "text-muted-foreground"
          )}
          onClick={() => setShowsOwnColors((shows) => !shows)}
          size="icon-sm"
          title={colorsLabel}
          type="button"
          variant="ghost"
        >
          {showsOwnColors ? <MoonIcon /> : <SunIcon />}
        </Button>
      ) : null}
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
          srcDoc={emailDocument}
          title="Email message content"
        />
      )}
    </div>
  );
};

export default MailMessageBody;
