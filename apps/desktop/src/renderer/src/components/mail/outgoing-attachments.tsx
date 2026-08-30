import { PaperclipIcon, XIcon } from "lucide-react";
import type { Ref, RefObject } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getHotkeyAriaLabel, getHotkeyDisplay } from "@/hotkeys";
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
  | "inputRef"
  | "removeAttachment"
  | "setReferencedInlineContentIds"
>;

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
  inputRef: RefObject<HTMLInputElement | null>;
  onFiles: (files: FileList | null) => void;
}

export const OutgoingAttachmentButton = ({
  command,
  disabled = false,
  focusRef,
  inputRef,
  onFiles,
}: OutgoingAttachmentButtonProps) => {
  const display = getHotkeyDisplay(command);

  return (
    <>
      <input
        className="hidden"
        multiple
        onChange={(event) => {
          onFiles(event.currentTarget.files);
        }}
        ref={inputRef}
        type="file"
      />
      <Button
        aria-keyshortcuts={getHotkeyAriaLabel(command)}
        aria-label={display.label}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        ref={focusRef}
        size="icon"
        title={`${display.label} (${display.bindings[0]})`}
        type="button"
        variant="ghost"
      >
        <PaperclipIcon />
      </Button>
    </>
  );
};

interface OutgoingAttachmentListProps {
  attachments: readonly MailDraftAttachment[];
  onRemove: (attachmentId: string) => void;
}

export const OutgoingAttachmentList = ({
  attachments,
  onRemove,
}: OutgoingAttachmentListProps) =>
  attachments.length === 0 ? null : (
    <section
      aria-label="Attachments"
      className="bg-card flex max-h-24 shrink-0 flex-wrap gap-2 overflow-y-auto px-4 py-2"
    >
      {attachments.map((attachment) => (
        <Badge
          className="h-7 max-w-72 gap-1.5 pr-1.5 pl-2.5"
          key={attachment.id}
          variant="secondary"
        >
          <PaperclipIcon aria-hidden="true" />
          <span className="min-w-0 truncate">{attachment.filename}</span>
          <span className="text-muted-foreground shrink-0">
            {formatAttachmentSize(attachment.size)}
          </span>
          <button
            aria-label={`Remove ${attachment.filename}`}
            className="hover:bg-foreground/10 focus-visible:ring-ring/50 grid size-4 shrink-0 place-items-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
            onClick={() => onRemove(attachment.id)}
            type="button"
          >
            <XIcon className="size-2.5" />
          </button>
        </Badge>
      ))}
    </section>
  );
