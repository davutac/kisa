import { PaperclipIcon, XIcon } from "lucide-react";
import { AnimatePresence, m, useReducedMotionConfig } from "motion/react";
import type { Ref } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileInput, FileInputTrigger } from "@/components/ui/file-input";
import type { FileInputController } from "@/components/ui/file-input";
import { getHotkeyAriaLabel, getHotkeyDisplay } from "@/hotkeys";
import { easeInOut, NO_MOTION } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { MailDraftAttachment } from "@/shared/ipc/mail";

import type { OutgoingAttachmentController } from "./use-outgoing-attachments";

export type OutgoingAttachmentComposerController = Pick<
  OutgoingAttachmentController,
  | "addAttachments"
  | "addInlineImages"
  | "attachments"
  | "discardInlineImages"
  | "fallbackInlineImagesToAttachments"
  | "getInlineImagePreview"
  | "loadInlineImagePreview"
  | "picker"
  | "removeAttachment"
  | "setReferencedInlineContentIds"
>;

const NO_FILES: File[] = [];

const formatAttachmentSize = (bytes: number): string => {
  if (bytes < 1000) {
    return `${bytes} B`;
  }

  if (bytes < 1_000_000) {
    return `${Math.ceil(bytes / 1000)} KB`;
  }

  return `${(bytes / 1_000_000).toFixed(1)} MB`;
};

interface OutgoingAttachmentButtonProps {
  command: "composer.attach" | "threadComposer.attach";
  disabled?: boolean;
  focusRef?: Ref<HTMLButtonElement>;
  onFiles: (files: readonly File[]) => void;
  picker: FileInputController;
}

// The picked files are handed on and never held: the draft's attachments,
// which main authorizes, are the list. The draft's own list announces nothing
// either, so neither does the picker, before main has accepted a file.
export const OutgoingAttachmentButton = ({
  command,
  disabled = false,
  focusRef,
  onFiles,
  picker,
}: OutgoingAttachmentButtonProps) => {
  const display = getHotkeyDisplay(command);

  return (
    <FileInput
      announcement={() => null}
      className="contents"
      controller={picker}
      disabled={disabled}
      multiple
      onValueChange={(_files, details) => {
        onFiles(details.added);
      }}
      value={NO_FILES}
    >
      <FileInputTrigger
        aria-keyshortcuts={getHotkeyAriaLabel(command)}
        aria-label={display.label}
        ref={focusRef}
        size="icon"
        title={`${display.label} (${display.bindings[0]})`}
      >
        <PaperclipIcon />
      </FileInputTrigger>
    </FileInput>
  );
};

interface OutgoingAttachmentListProps {
  attachments: readonly MailDraftAttachment[];
  /** Restyles the tray, e.g. to sit on the page instead of a card. */
  className?: string;
  onRemove: (attachmentId: string) => void;
}

// Pills enter and leave as the draft history's do. The tray itself appears
// with its first pill and goes with its last, so those two don't animate.
export const OutgoingAttachmentList = ({
  attachments,
  className,
  onRemove,
}: OutgoingAttachmentListProps) => {
  const shouldReduceMotion = useReducedMotionConfig();

  return attachments.length === 0 ? null : (
    <section
      aria-label="Attachments"
      className={cn(
        "bg-card relative flex max-h-24 shrink-0 flex-wrap gap-1 overflow-y-auto px-2 py-1.5",
        className
      )}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {attachments.map((attachment) => (
          <m.div
            animate={{ opacity: 1, scale: 1, x: 0 }}
            className="flex"
            exit={{ opacity: 0, scale: 0.96, x: -4 }}
            initial={
              shouldReduceMotion ? false : { opacity: 0, scale: 0.96, x: -4 }
            }
            key={attachment.id}
            layout={shouldReduceMotion ? false : "position"}
            transition={shouldReduceMotion ? NO_MOTION : easeInOut(0.16)}
          >
            <Badge
              className="h-7 max-w-72 gap-1.5 pr-1.5 pl-2.5"
              variant="secondary"
            >
              <PaperclipIcon aria-hidden="true" />
              <span className="min-w-0 truncate">{attachment.filename}</span>
              <span className="text-muted-foreground shrink-0">
                {formatAttachmentSize(attachment.size)}
              </span>
              <Button
                aria-label={`Remove ${attachment.filename}`}
                className="hover:bg-foreground/10 size-4 rounded-full"
                onClick={() => onRemove(attachment.id)}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <XIcon className="size-2.5" />
              </Button>
            </Badge>
          </m.div>
        ))}
      </AnimatePresence>
    </section>
  );
};
