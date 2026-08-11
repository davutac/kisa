import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist";
// Vite's `?url` module keeps the worker local to the packaged renderer.
// oxlint-disable-next-line import/default
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";

import { PreviewError, PreviewPending } from "./preview-status";

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

export default PdfPreview;
