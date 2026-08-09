import "../assets/main.css";
import { DownloadIcon, FileWarningIcon } from "lucide-react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist";
// Vite's `?url` module keeps the worker local to the packaged renderer.
// oxlint-disable-next-line import/default
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { GmailAttachmentPreview } from "@/shared/ipc/mail";
import { TITLEBAR_HEIGHT } from "@/shared/window-chrome";

type PreviewState =
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "loading" }
  | { readonly data: GmailAttachmentPreview; readonly status: "ready" };

const formatBytes = (bytes: number): string => {
  if (bytes < 1000) {
    return `${bytes} B`;
  }

  if (bytes < 1_000_000) {
    return `${(bytes / 1000).toFixed(1)} KB`;
  }

  return `${(bytes / 1_000_000).toFixed(1)} MB`;
};

const PreviewPending = ({ label }: { label: string }) => (
  <div
    aria-live="polite"
    className="text-muted-foreground flex min-h-full items-center justify-center gap-2 text-sm"
  >
    <Spinner />
    {label}
  </div>
);

const PreviewError = ({ message }: { message: string }) => (
  <div className="text-muted-foreground flex min-h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm">
    <FileWarningIcon aria-hidden="true" className="size-8" />
    <p>{message}</p>
  </div>
);

const ImagePreview = ({
  attachment,
}: {
  attachment: GmailAttachmentPreview;
}) => {
  const [failed, setFailed] = useState(false);
  const url = useMemo(
    () =>
      URL.createObjectURL(
        new Blob([new Uint8Array(attachment.bytes).buffer], {
          type: attachment.mediaType,
        })
      ),
    [attachment.bytes, attachment.mediaType]
  );

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  if (failed) {
    return <PreviewError message="This image format could not be displayed." />;
  }

  return (
    <div className="min-h-full w-full">
      <img
        alt={attachment.filename}
        className="block h-auto w-full"
        onError={() => setFailed(true)}
        src={url}
      />
    </div>
  );
};

const PdfPage = ({
  document,
  pageNumber,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
}) => {
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [height, setHeight] = useState(792);
  const [width, setWidth] = useState(0);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (container === null) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting === true),
      { rootMargin: "900px 0px" }
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [container]);

  useEffect(() => {
    if (container === null) {
      return;
    }
    const updateWidth = (nextWidth: number): void => {
      const roundedWidth = Math.floor(nextWidth);
      setWidth((currentWidth) =>
        currentWidth === roundedWidth ? currentWidth : roundedWidth
      );
    };
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) {
        updateWidth(entry.contentRect.width);
      }
    });
    updateWidth(container.getBoundingClientRect().width);
    observer.observe(container);
    return () => observer.disconnect();
  }, [container]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!(visible && canvas !== null && width > 0)) {
      return;
    }

    let cancelled = false;
    let page: PDFPageProxy | undefined;
    let renderTask: RenderTask | undefined;

    const render = async (): Promise<void> => {
      try {
        page = await document.getPage(pageNumber);
        if (cancelled) {
          return;
        }
        const baseViewport = page.getViewport({ scale: 1 });
        const cssScale = width / baseViewport.width;
        const viewport = page.getViewport({ scale: cssScale });
        const outputScale = window.devicePixelRatio || 1;

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = "100%";
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        setHeight(Math.floor(viewport.height));
        renderTask = page.render({
          canvas,
          transform:
            outputScale === 1
              ? undefined
              : [outputScale, 0, 0, outputScale, 0, 0],
          viewport,
        });
        await renderTask.promise;
      } catch {
        if (!cancelled) {
          setFailed(true);
        }
      } finally {
        page?.cleanup();
      }
    };
    void render();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [document, pageNumber, visible, width]);

  return (
    <section
      aria-label={`Page ${pageNumber}`}
      className="mx-auto w-full"
      ref={setContainer}
      style={{ minHeight: height }}
    >
      {failed ? (
        <PreviewError message={`Page ${pageNumber} could not be displayed.`} />
      ) : null}
      {visible && !failed ? (
        <canvas
          className="block max-w-full bg-white shadow-lg"
          ref={canvasRef}
        />
      ) : null}
    </section>
  );
};

const PdfPreview = ({ bytes }: { bytes: Uint8Array }) => {
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [error, setError] = useState(false);

  useEffect(() => {
    let disposed = false;
    let loadingTask: PDFDocumentLoadingTask | undefined;

    const load = async (): Promise<void> => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes) });
        const nextDocument = await loadingTask.promise;

        if (disposed) {
          await loadingTask.destroy();
          return;
        }
        setDocument(nextDocument);
      } catch {
        if (!disposed) {
          setError(true);
        }
      }
    };
    void load();
    return () => {
      disposed = true;
      void loadingTask?.destroy();
    };
  }, [bytes]);

  if (error) {
    return <PreviewError message="This PDF could not be displayed." />;
  }
  if (document === undefined) {
    return <PreviewPending label="Preparing PDF…" />;
  }

  return (
    <div className="flex min-h-full flex-col gap-6 bg-black/20">
      {Array.from({ length: document.numPages }, (_unused, index) => (
        <PdfPage document={document} key={index + 1} pageNumber={index + 1} />
      ))}
    </div>
  );
};

const AttachmentPreviewApp = () => {
  const bridge = window.attachmentPreview;
  const [state, setState] = useState<PreviewState>(() =>
    bridge === undefined
      ? { message: "Attachment preview is unavailable.", status: "error" }
      : { status: "loading" }
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  useEffect(() => {
    if (bridge === undefined) {
      return;
    }

    let disposed = false;
    const load = async (): Promise<void> => {
      try {
        const reply = await bridge.load();

        if (!disposed) {
          setState(
            reply.ok
              ? { data: reply.data, status: "ready" }
              : { message: reply.error, status: "error" }
          );
        }
      } catch {
        if (!disposed) {
          setState({ message: "Could not load attachment.", status: "error" });
        }
      }
    };

    void load();
    return () => {
      disposed = true;
    };
  }, [bridge]);

  const save = async (): Promise<void> => {
    if (bridge === undefined || saving) {
      return;
    }

    setSaving(true);
    setSaveError(undefined);

    try {
      const reply = await bridge.save();

      if (!reply.ok) {
        setSaveError(reply.error);
      }
    } catch {
      setSaveError("Could not save attachment.");
    } finally {
      setSaving(false);
    }
  };

  const attachment = state.status === "ready" ? state.data : undefined;
  let content;

  if (state.status === "loading") {
    content = <PreviewPending label="Loading attachment…" />;
  } else if (state.status === "error") {
    content = <PreviewError message={state.message} />;
  } else if (state.data.kind === "image") {
    content = <ImagePreview attachment={state.data} />;
  } else {
    content = <PdfPreview bytes={state.data.bytes} />;
  }

  return (
    <main
      className="grid h-svh overflow-hidden"
      style={{
        gridTemplateRows: `${TITLEBAR_HEIGHT}px minmax(0, 1fr)`,
      }}
    >
      <header className="app-titlebar bg-background flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs font-medium">
              {attachment?.filename ?? "Attachment preview"}
            </span>
            {saveError === undefined && attachment !== undefined ? (
              <span className="text-muted-foreground text-[0.625rem]">
                {formatBytes(attachment.bytes.byteLength)}
              </span>
            ) : null}
          </div>
          {saveError === undefined ? null : (
            <p
              className="text-destructive truncate text-[0.625rem]"
              role="alert"
            >
              {saveError}
            </p>
          )}
        </div>
        <Button
          disabled={attachment === undefined || saving}
          onClick={save}
          type="button"
          variant="secondary"
        >
          {saving ? <Spinner /> : <DownloadIcon data-icon="inline-start" />}
          Download
        </Button>
      </header>
      <section className="min-h-0 overflow-auto">{content}</section>
    </main>
  );
};

const rootElement = document.querySelector("#root");

if (rootElement === null) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <AttachmentPreviewApp />
  </StrictMode>
);
