import { CopyIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

import { useTheme } from "@/components/shell/theme-provider";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  createEmailDocument,
  isParsedMessageDocument,
  prepareEmailLinks,
} from "@/mail/email-frame";
import { needsLightSurface } from "@/mail/email-surface";
import { blockRemoteImages } from "@/mail/remote-images";
import type { MessageBody } from "@/shared/ipc/mail";

interface MailMessageBodyProps {
  allowRemoteImages: boolean;
  body: MessageBody;
  fallbackText: string;
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
