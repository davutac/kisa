import { PaperclipIcon } from "lucide-react";
import { m, useReducedMotionConfig } from "motion/react";
import { useRef, useState } from "react";
import type { ReactNode } from "react";

import { DialogContent } from "@/components/ui/dialog";
import { easeInOut, NO_MOTION } from "@/lib/motion";

interface NewMessageDialogShellProps {
  children: ReactNode;
  initialFocus: () => HTMLElement | null;
  onFiles: (files: FileList) => void;
}

const isComposerDropTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest("[data-composer-drop-target]") !== null;

const NewMessageDialogShell = ({
  children,
  initialFocus,
  onFiles,
}: NewMessageDialogShellProps) => {
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const fileDragDepthRef = useRef(0);
  const shouldReduceMotion = useReducedMotionConfig();
  const resetFileDrag = (): void => {
    fileDragDepthRef.current = 0;
    setIsDraggingFiles(false);
  };

  return (
    <DialogContent
      className="top-[calc(var(--app-titlebar-height)+1rem)] flex max-h-[calc(100svh-var(--app-titlebar-height)-2rem)] min-h-0 translate-y-0 flex-col gap-0 overflow-hidden p-0 ring-0 sm:max-w-2xl"
      initialFocus={initialFocus}
      onDragEndCapture={(event) => {
        if (!event.dataTransfer.types.includes("Files")) {
          return;
        }
        if (isComposerDropTarget(event.target)) {
          resetFileDrag();
          return;
        }
        event.stopPropagation();
        resetFileDrag();
      }}
      onDragEnterCapture={(event) => {
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
      }}
      onDragLeaveCapture={(event) => {
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
      }}
      onDragOverCapture={(event) => {
        if (isComposerDropTarget(event.target)) {
          resetFileDrag();
          return;
        }
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDropCapture={(event) => {
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
      }}
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          event.stopPropagation();
        }
      }}
    >
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
      {children}
    </DialogContent>
  );
};

export default NewMessageDialogShell;
