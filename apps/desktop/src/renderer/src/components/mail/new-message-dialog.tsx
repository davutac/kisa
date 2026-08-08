import {
  LoaderCircleIcon,
  PaperclipIcon,
  SendIcon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import { m, useReducedMotion } from "motion/react";
import { Fragment, useRef, useState } from "react";
import { toast } from "sonner";

import EmailComposer from "@/components/mail/email-composer";
import type { EmailComposerValue } from "@/components/mail/email-composer";
import EmailRecipientFields from "@/components/mail/email-recipient-fields";
import type { EmailRecipients } from "@/components/mail/email-recipient-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AppCommand,
  COMPOSER_ACCOUNT_COMMAND_IDS,
  getHotkeyAriaLabel,
  getHotkeyDisplay,
  HotkeyHint,
  useAppCommand,
} from "@/hotkeys";
import type { HotkeyCommandId } from "@/hotkeys";
import { easeInOut, NO_MOTION } from "@/lib/motion";
import { getMailApi, getPathForFile } from "@/platform/desktop";
import type { GoogleAccount } from "@/shared/ipc/auth";
import { MAX_GMAIL_ATTACHMENT_BYTES } from "@/shared/ipc/mail";
import type { GmailOutgoingAttachment } from "@/shared/ipc/mail";

interface NewMessageDialogProps {
  accounts: readonly GoogleAccount[];
  initialAccountId: string | null;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

const EMPTY_COMPOSER_VALUE: EmailComposerValue = {
  html: "",
  isEmpty: true,
  text: "",
};

const EMPTY_RECIPIENTS: EmailRecipients = { bcc: [], cc: [], to: [] };

type ComposerAttachment = GmailOutgoingAttachment & {
  readonly id: string;
  readonly size: number;
};

const formatAttachmentSize = (bytes: number): string => {
  if (bytes < 1000) {
    return `${bytes} B`;
  }

  if (bytes < 1_000_000) {
    return `${Math.ceil(bytes / 1000)} KB`;
  }

  return `${(bytes / 1_000_000).toFixed(1)} MB`;
};

interface AccountPickerButtonProps {
  account: GoogleAccount;
  autoFocus: boolean;
  command?: HotkeyCommandId;
  isSelected: boolean;
  onSelect: () => void;
}

const AccountPickerButton = ({
  account,
  autoFocus,
  command,
  isSelected,
  onSelect,
}: AccountPickerButtonProps) => {
  const shouldReduceMotion = useReducedMotion();

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-keyshortcuts={
              command === undefined ? undefined : getHotkeyAriaLabel(command)
            }
            aria-label={`Send from ${account.email}`}
            aria-pressed={isSelected}
            autoFocus={autoFocus}
            className="h-7 min-w-7 justify-start gap-0 overflow-visible rounded-full p-0"
            onClick={onSelect}
            type="button"
            variant="secondary"
          >
            <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full">
              {account.avatarUrl === undefined ? (
                <UserRoundIcon className="size-3.5" />
              ) : (
                <img
                  alt=""
                  className="size-full object-cover"
                  src={account.avatarUrl}
                />
              )}
            </span>
            <m.span
              animate={
                isSelected
                  ? { opacity: 1, width: "auto" }
                  : { opacity: 0, width: 0 }
              }
              aria-hidden="true"
              className="block overflow-hidden"
              initial={false}
              transition={shouldReduceMotion ? NO_MOTION : easeInOut(0.22)}
            >
              <span className="block max-w-48 truncate px-2.5 pl-1.5">
                {account.email}
              </span>
            </m.span>
          </Button>
        }
      />
      <TooltipContent className="flex items-start gap-2" side="bottom">
        <span className="flex flex-col">
          {account.displayName === undefined ? null : (
            <span>{account.displayName}</span>
          )}
          <span
            className={account.displayName === undefined ? "" : "opacity-70"}
          >
            {account.email}
          </span>
        </span>
        {command === undefined ? null : <HotkeyHint command={command} />}
      </TooltipContent>
    </Tooltip>
  );
};

const NewMessageDialog = ({
  accounts,
  initialAccountId,
  isOpen,
  onOpenChange,
}: NewMessageDialogProps) => {
  const knownInitialAccountId = accounts.some(
    ({ email }) => email === initialAccountId
  )
    ? (initialAccountId ?? "")
    : "";
  const [accountId, setAccountId] = useState(knownInitialAccountId);
  const [attachments, setAttachments] = useState<readonly ComposerAttachment[]>(
    []
  );
  const [composer, setComposer] = useState(EMPTY_COMPOSER_VALUE);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [recipients, setRecipients] = useState(EMPTY_RECIPIENTS);
  const [subject, setSubject] = useState("");
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const fileDragDepthRef = useRef(0);
  const mailApi = getMailApi();
  const selectedAccountId = accounts.some(({ email }) => email === accountId)
    ? accountId
    : "";
  const canSend =
    mailApi !== undefined &&
    selectedAccountId.length > 0 &&
    recipients.to.length > 0 &&
    subject.trim().length > 0 &&
    !composer.isEmpty &&
    !isSending;
  const sendDisplay = getHotkeyDisplay("composer.send");

  const addAttachments = (fileList: FileList | null): void => {
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
      const loaded = files.map((file): ComposerAttachment => {
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
      if (attachmentInputRef.current !== null) {
        attachmentInputRef.current.value = "";
      }
    }
  };

  const send = async (): Promise<void> => {
    if (!canSend) {
      return;
    }

    setIsSending(true);

    try {
      const reply = await mailApi.sendMessage({
        accountId: selectedAccountId,
        attachments: attachments.map(({ filename, mediaType, path }) => ({
          filename,
          mediaType,
          path,
        })),
        bcc: recipients.bcc,
        body: { html: composer.html, text: composer.text },
        cc: recipients.cc,
        subject,
        to: recipients.to,
      });

      if (!reply.ok) {
        toast.error(reply.error);
        return;
      }

      toast.success("Message sent");
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not send message"
      );
    } finally {
      setIsSending(false);
    }
  };

  useAppCommand(
    "composer.send",
    () => {
      void send();
    },
    { enabled: isOpen && canSend }
  );

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!isSending) {
          onOpenChange(open);
        }
      }}
      open={isOpen}
    >
      <DialogContent
        className="top-[calc(var(--app-titlebar-height)+1rem)] flex max-h-[calc(100svh-var(--app-titlebar-height)-2rem)] min-h-0 translate-y-0 flex-col gap-0 overflow-hidden p-0 ring-0 sm:max-w-2xl"
        onDragEndCapture={(event) => {
          if (!event.dataTransfer.types.includes("Files")) {
            return;
          }

          event.stopPropagation();
          fileDragDepthRef.current = 0;
          setIsDraggingFiles(false);
        }}
        onDragEnterCapture={(event) => {
          if (!event.dataTransfer.types.includes("Files")) {
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

          event.stopPropagation();
          fileDragDepthRef.current = Math.max(fileDragDepthRef.current - 1, 0);

          if (fileDragDepthRef.current === 0) {
            setIsDraggingFiles(false);
          }
        }}
        onDragOverCapture={(event) => {
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

          event.preventDefault();
          event.stopPropagation();
          fileDragDepthRef.current = 0;
          setIsDraggingFiles(false);
          addAttachments(event.dataTransfer.files);
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
          transition={easeInOut(0.15)}
        >
          <div className="text-muted-foreground flex flex-col items-center gap-2 font-medium">
            <PaperclipIcon className="size-6" />
            Drop files to attach
          </div>
        </m.div>
        <DialogHeader className="shrink-0 px-4 py-3 pr-12">
          <DialogTitle className="shrink-0">New email</DialogTitle>
          <DialogDescription className="sr-only">
            Write and send a new email message
          </DialogDescription>
        </DialogHeader>
        <form
          className="bg-background flex min-h-0 flex-1 flex-col gap-px overflow-hidden"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className="bg-card flex min-h-9 shrink-0 items-center px-4 py-1">
            <span className="text-muted-foreground w-10 shrink-0">From</span>
            <fieldset
              aria-label="From account"
              className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto"
            >
              {accounts.map((account, index) => {
                const command = COMPOSER_ACCOUNT_COMMAND_IDS[index];
                const selectAccount = (): void => {
                  setAccountId(account.email);
                };

                return (
                  <Fragment key={account.email}>
                    {command === undefined ? null : (
                      <AppCommand callback={selectAccount} command={command} />
                    )}
                    <AccountPickerButton
                      account={account}
                      autoFocus={selectedAccountId.length === 0 && index === 0}
                      command={command}
                      isSelected={account.email === selectedAccountId}
                      onSelect={selectAccount}
                    />
                  </Fragment>
                );
              })}
            </fieldset>
          </div>
          <EmailRecipientFields
            accountId={selectedAccountId}
            autoFocus={selectedAccountId.length > 0}
            className="shrink-0"
            key={selectedAccountId}
            onChange={setRecipients}
            value={recipients}
          />
          <InputGroup className="bg-card dark:bg-card h-9 shrink-0 rounded-none border-0 px-4 shadow-none has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0">
            <InputGroupAddon className="w-10 justify-start p-0">
              <label htmlFor="new-message-subject">Subject</label>
            </InputGroupAddon>
            <InputGroupInput
              className="h-8 px-0 text-sm md:text-sm"
              id="new-message-subject"
              onChange={(event) => {
                setSubject(event.currentTarget.value);
              }}
              value={subject}
            />
          </InputGroup>
          <EmailComposer
            ariaLabel="Message"
            className="min-h-32 flex-1 border-0"
            consumeModEnter
            onChange={setComposer}
            placeholder="Write a message"
            toolbarActions={
              <>
                <input
                  className="hidden"
                  multiple
                  onChange={(event) => {
                    addAttachments(event.currentTarget.files);
                  }}
                  ref={attachmentInputRef}
                  type="file"
                />
                <Button
                  aria-label="Attach files"
                  onClick={() => {
                    attachmentInputRef.current?.click();
                  }}
                  size="icon"
                  title="Attach files"
                  type="button"
                  variant="ghost"
                >
                  <PaperclipIcon />
                </Button>
              </>
            }
          />
          {attachments.length === 0 ? null : (
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
                  <span className="min-w-0 truncate">
                    {attachment.filename}
                  </span>
                  <span className="text-muted-foreground shrink-0">
                    {formatAttachmentSize(attachment.size)}
                  </span>
                  <button
                    aria-label={`Remove ${attachment.filename}`}
                    className="hover:bg-foreground/10 focus-visible:ring-ring/50 grid size-4 shrink-0 place-items-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
                    onClick={() => {
                      setAttachments((current) =>
                        current.filter(({ id }) => id !== attachment.id)
                      );
                    }}
                    type="button"
                  >
                    <XIcon className="size-2.5" />
                  </button>
                </Badge>
              ))}
            </section>
          )}
          <div className="bg-card flex shrink-0 items-center">
            <Button
              aria-keyshortcuts={getHotkeyAriaLabel("composer.send")}
              className="relative h-auto w-full rounded-none px-4 py-2 text-lg"
              disabled={!canSend}
              title={`${sendDisplay.label} (${sendDisplay.bindings[0]?.join("+")})`}
              type="submit"
              variant="secondary"
            >
              {isSending ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <SendIcon />
              )}
              {isSending ? "Sending…" : "Send"}
              <HotkeyHint
                className="absolute right-4"
                command="composer.send"
              />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default NewMessageDialog;
