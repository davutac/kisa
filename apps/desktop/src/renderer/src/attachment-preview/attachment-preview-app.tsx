import { DownloadIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { GmailAttachmentPreview } from "@/shared/ipc/mail";
import { TITLEBAR_HEIGHT } from "@/shared/window-chrome";

import ImagePreview from "./image-preview";
import PdfPreview from "./pdf-preview";
import { PreviewError, PreviewPending } from "./preview-status";

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
    content = <PreviewPending label="Opening the envelope…" />;
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
      style={{ gridTemplateRows: `${TITLEBAR_HEIGHT}px minmax(0, 1fr)` }}
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

export default AttachmentPreviewApp;
