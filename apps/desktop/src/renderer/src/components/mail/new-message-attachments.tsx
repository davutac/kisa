import { PaperclipIcon, XIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { Ref, RefObject } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getHotkeyAriaLabel, getHotkeyDisplay } from "@/hotkeys";
import { getPathForFile } from "@/platform/desktop";
import { MAX_GMAIL_ATTACHMENT_BYTES } from "@/shared/ipc/mail";
import type { MailDraftAttachment } from "@/shared/ipc/mail";

const formatAttachmentSize = (bytes: number): string => {
  if (bytes < 1000) {
    return `${bytes} B`;
  }

  if (bytes < 1_000_000) {
    return `${Math.ceil(bytes / 1000)} KB`;
  }

  return `${(bytes / 1_000_000).toFixed(1)} MB`;
};

export const useNewMessageAttachments = () => {
  const [attachments, setAttachments] = useState<
    readonly MailDraftAttachment[]
  >([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const addAttachments = useCallback(
    (fileList: FileList | null): void => {
      const files = [...(fileList ?? [])];
      if (files.length === 0) {
        return;
      }

      const currentBytes = attachments.reduce(
        (total, attachment) => total + attachment.size,
        0
      );
      const selectedBytes = files.reduce((total, file) => total + file.size, 0);
      if (currentBytes + selectedBytes > MAX_GMAIL_ATTACHMENT_BYTES) {
        toast.error("Attachments can total up to 25 MB");
        return;
      }

      try {
        const loaded = files.map((file): MailDraftAttachment => {
          const path = getPathForFile(file);
          if (path === undefined || path.length === 0) {
            throw new Error(`Could not access ${file.name || "attachment"}`);
          }

          return {
            filename: file.name.length === 0 ? "attachment" : file.name,
            id: crypto.randomUUID(),
            mediaType:
              file.type.length === 0 ? "application/octet-stream" : file.type,
            path,
            size: file.size,
          };
        });

        setAttachments((current) => [...current, ...loaded]);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not attach files"
        );
      } finally {
        if (inputRef.current !== null) {
          inputRef.current.value = "";
        }
      }
    },
    [attachments]
  );

  return { addAttachments, attachments, inputRef, setAttachments };
};

interface NewMessageAttachmentButtonProps {
  focusRef?: Ref<HTMLButtonElement>;
  inputRef: RefObject<HTMLInputElement | null>;
  onFiles: (files: FileList | null) => void;
}

export const NewMessageAttachmentButton = ({
  focusRef,
  inputRef,
  onFiles,
}: NewMessageAttachmentButtonProps) => {
  const display = getHotkeyDisplay("composer.attach");

  return (
    <>
      <input
        className="hidden"
        multiple
        onChange={(event) => onFiles(event.currentTarget.files)}
        ref={inputRef}
        type="file"
      />
      <Button
        aria-keyshortcuts={getHotkeyAriaLabel("composer.attach")}
        aria-label={display.label}
        onClick={() => inputRef.current?.click()}
        ref={focusRef}
        size="icon"
        title={`${display.label} (${display.bindings[0]?.join("+")})`}
        type="button"
        variant="ghost"
      >
        <PaperclipIcon />
      </Button>
    </>
  );
};

interface NewMessageAttachmentListProps {
  attachments: readonly MailDraftAttachment[];
  onRemove: (attachmentId: string) => void;
}

export const NewMessageAttachmentList = ({
  attachments,
  onRemove,
}: NewMessageAttachmentListProps) =>
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
