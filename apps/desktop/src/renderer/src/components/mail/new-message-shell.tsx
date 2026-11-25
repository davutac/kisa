import { PaperclipIcon } from "lucide-react";
import { m, useReducedMotionConfig } from "motion/react";
import { useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, ReactNode } from "react";

import { easeInOut, NO_MOTION } from "@/lib/motion";

interface NewMessageShellProps {
  children: ReactNode;
  onFiles: (files: FileList) => void;
}

const isComposerDropTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest("[data-composer-drop-target]") !== null;

/**
 * Files dropped anywhere on the composer attach to it, except over the
 * message editor, which takes its own drops as inline content. Not a
 * FileInputDropzone: one claims every drop inside it before its children see
 * it, so the editor would never place an image inline.
 */
const useComposerFileDrop = (onFiles: (files: FileList) => void) => {
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const fileDragDepthRef = useRef(0);

  const resetFileDrag = (): void => {
    fileDragDepthRef.current = 0;
    setIsDraggingFiles(false);
  };

  return {
    handlers: {
      onDragEndCapture: (event: DragEvent) => {
        if (!event.dataTransfer.types.includes("Files")) {
          return;
        }

        if (isComposerDropTarget(event.target)) {
          resetFileDrag();

          return;
        }

        event.stopPropagation();
        resetFileDrag();
      },
      onDragEnterCapture: (event: DragEvent) => {
        if (!event.dataTransfer.types.includes("Files")) {
          return;
        }

        if (isComposerDropTarget(event.target)) {
          resetFileDrag();

          return;
        }

        event.preventDefault();
        event.stopPropagation();
        fileDragDepthRef.current += 1;
        setIsDraggingFiles(true);
      },
      onDragLeaveCapture: (event: DragEvent) => {
        if (!event.dataTransfer.types.includes("Files")) {
          return;
        }

        if (isComposerDropTarget(event.target)) {
          resetFileDrag();

          return;
        }

        event.stopPropagation();
        fileDragDepthRef.current = Math.max(fileDragDepthRef.current - 1, 0);

        if (fileDragDepthRef.current === 0) {
          setIsDraggingFiles(false);
        }
      },
      onDragOverCapture: (event: DragEvent) => {
        if (isComposerDropTarget(event.target)) {
          resetFileDrag();

          return;
        }

        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "copy";
        }
      },
      onDropCapture: (event: DragEvent) => {
        if (!event.dataTransfer.types.includes("Files")) {
          return;
        }

        if (isComposerDropTarget(event.target)) {
          resetFileDrag();

          return;
        }

        event.preventDefault();
        event.stopPropagation();
        resetFileDrag();
        onFiles(event.dataTransfer.files);
      },
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === "Tab") {
          event.stopPropagation();
        }
      },
    },
    isDraggingFiles,
  };
};

const FileDropOverlay = ({
  isDraggingFiles,
}: {
  readonly isDraggingFiles: boolean;
}) => {
  const shouldReduceMotion = useReducedMotionConfig();

  return (
    <m.div
      animate={{ opacity: isDraggingFiles ? 1 : 0 }}
      aria-hidden="true"
      className="bg-background/90 pointer-events-none absolute inset-2 z-50 grid place-items-center rounded-lg border-2 border-dashed"
      initial={false}
      transition={shouldReduceMotion ? NO_MOTION : easeInOut(0.15)}
    >
      <div className="text-muted-foreground flex flex-col items-center gap-2 font-medium">
        <PaperclipIcon className="size-6" />
        Drop files to attach
      </div>
    </m.div>
  );
};

/** The composer as its own page, filling the content column. */
export const NewMessagePageShell = ({
  children,
  labelledBy,
  onFiles,
}: NewMessageShellProps & {
  readonly labelledBy: string;
}) => {
  const { handlers, isDraggingFiles } = useComposerFileDrop(onFiles);

  return (
    <section
      aria-labelledby={labelledBy}
      className="bg-background relative flex min-h-0 flex-1 flex-col"
      {...handlers}
    >
      <FileDropOverlay isDraggingFiles={isDraggingFiles} />
      <div className="flex min-h-0 w-full flex-1 flex-col">{children}</div>
    </section>
  );
};
