import {
  LoaderCircleIcon,
  MessageSquarePlusIcon,
  SendIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { Ref } from "react";

import EmailRecipientFields from "@/components/mail/email-recipient-fields";
import MailForwardedMessage from "@/components/mail/forwarded-message";
import MailComposer from "@/components/mail/mail-composer";
import MailMessageAttachments from "@/components/mail/message-attachments";
import MailRelativeTime from "@/components/mail/relative-time";
import type { ComposerFocusHandle } from "@/components/mail/use-composer-focus";
import { Button } from "@/components/ui/button";
import {
  getHotkeyAriaLabel,
  HotkeyHint,
  useAppCommand,
  useHotkeyLayer,
} from "@/hotkeys";
import { parseMailboxAddress } from "@/mail/address";
import type { MailMessageAction } from "@/mail/reply-recipients";
import type { GmailThreadMessage, MailDraftInput } from "@/shared/ipc/mail";

import CreateReplyForm from "./create-reply-form";
import { useReplyWorkspace } from "./use-reply-workspace";

interface MailReplyAreaProps {
  accountId: string;
  action: MailMessageAction;
  draft: MailDraftInput;
  message: GmailThreadMessage;
  onCancel: () => void;
  onClose: (draft: MailDraftInput) => void;
  onSent: () => void;
  onComposerReady?: (handle: ComposerFocusHandle | null) => void;
  sectionRef?: Ref<HTMLElement>;
  suggestedAddresses: readonly string[];
  threadId: string;
}

const MailReplyArea = ({
  accountId,
  action,
  draft,
  message,
  onCancel,
  onClose,
  onComposerReady,
  onSent,
  sectionRef,
  suggestedAddresses,
  threadId,
}: MailReplyAreaProps) => {
  const composerHandleRef = useRef<ComposerFocusHandle | null>(null);
  const replyInstructionsRef = useRef<HTMLTextAreaElement>(null);
  const [isReplyPopoverOpen, setIsReplyPopoverOpen] = useState(false);
  const replaceComposerContent = useCallback((content: string): boolean => {
    const replaceContent = composerHandleRef.current?.replaceContent;
    if (replaceContent === undefined) {
      return false;
    }
    replaceContent(content);
    return true;
  }, []);
  const workspace = useReplyWorkspace({
    accountId,
    action,
    draft,
    message,
    onCancel,
    onSent,
    replaceComposerContent,
    threadId,
  });
  const isForward = action === "forward";
  const handleDiscard = workspace.discard;
  const handleDismissCleanVersion = workspace.dismissCleanVersion;
  const handleComposerChange = workspace.setComposer;
  const handleCreateReply = workspace.createReply;
  const handleRecipientsChange = workspace.setRecipients;
  const handleSend = workspace.send;
  const canSend = workspace.canSend && !isReplyPopoverOpen;
  const handleSelectCleanVersion = workspace.selectCleanVersion;
  const handleComposerReady = useCallback(
    (handle: ComposerFocusHandle | null): void => {
      composerHandleRef.current = handle;
      onComposerReady?.(handle);
    },
    [onComposerReady]
  );
  const handleClose = (): void => {
    if (isReplyPopoverOpen) {
      setIsReplyPopoverOpen(false);
      return;
    }
    onClose(workspace.currentDraft);
  };
  const sender = parseMailboxAddress(message.from);
  const targetLabel = sender.name ?? sender.email;

  useHotkeyLayer("thread-composer", true);
  useAppCommand("threadComposer.close", handleClose, {
    enabled: !workspace.isBusy,
  });
  useAppCommand("threadComposer.clean", workspace.clean, {
    enabled: workspace.canClean,
  });
  useAppCommand(
    "threadComposer.createReply",
    () => setIsReplyPopoverOpen(true),
    {
      enabled: workspace.canCreateReply,
    }
  );
  useAppCommand("threadComposer.send", handleSend, {
    enabled: canSend,
  });

  return (
    <section
      aria-label={isForward ? "Forward message" : "Reply"}
      className="scroll-mt-20 overflow-hidden"
      ref={sectionRef}
    >
      <div className="bg-card text-muted-foreground flex min-w-0 items-center gap-1.5 px-4 py-2 text-xs">
        <span className="truncate">
          {isForward ? "Forwarding message from" : "Replying to"} {targetLabel}
        </span>
        <span aria-hidden="true">·</span>
        <MailRelativeTime timestamp={message.sentAt} />
      </div>
      <EmailRecipientFields
        accountId={accountId}
        disabled={workspace.isInputDisabled}
        onChange={handleRecipientsChange}
        suggestedAddresses={suggestedAddresses}
        value={workspace.recipients}
      />
      <MailComposer
        aiActionGroupLabel="AI reply actions"
        aiActions={[
          ...(isForward
            ? []
            : [
                {
                  command: "threadComposer.createReply" as const,
                  disabled: !workspace.canCreateReply,
                  icon: MessageSquarePlusIcon,
                  isWorking: workspace.isCreatingReply,
                  label: "Create reply",
                  modelLabel: workspace.aiModelLabel,
                  popover: {
                    content: (
                      <CreateReplyForm
                        onClose={() => setIsReplyPopoverOpen(false)}
                        onCreate={handleCreateReply}
                        textareaRef={replyInstructionsRef}
                      />
                    ),
                    handleOpenChange: setIsReplyPopoverOpen,
                    initialFocus: replyInstructionsRef,
                    open: isReplyPopoverOpen,
                  },
                  workingLabel: "Creating…",
                },
              ]),
          {
            command: "threadComposer.clean",
            disabled: !workspace.canClean,
            icon: SparklesIcon,
            isWorking: false,
            label: "Clean",
            modelLabel: workspace.aiModelLabel,
            onClick: () => {
              void workspace.clean();
            },
            workingLabel: "Cleaning…",
          },
        ]}
        ariaLabel="Message"
        attachments={{
          command: "threadComposer.attach",
          controller: workspace.outgoingAttachments,
        }}
        className="min-h-48"
        consumeModEnter
        contentKey={draft.id}
        defaultValue={draft.body.html}
        disabled={workspace.isInputDisabled}
        focusHandleRef={handleComposerReady}
        focusAtStart={workspace.isBodyOnlySignature}
        groupAiActions
        onChange={handleComposerChange}
        placeholder={isForward ? "Add a message" : "Write a reply"}
        history={{
          onDismiss: handleDismissCleanVersion,
          onSelect: handleSelectCleanVersion,
          selectedVersionId: workspace.selectedCleanVersionId,
          versions: workspace.cleanHistory,
        }}
      />
      {isForward ? (
        <>
          <MailForwardedMessage message={message} />
          <MailMessageAttachments
            accountId={accountId}
            attachments={message.attachments}
          />
        </>
      ) : null}
      <div className="bg-background flex shrink-0 items-stretch">
        <Button
          aria-keyshortcuts={getHotkeyAriaLabel("threadComposer.send")}
          disabled={!canSend}
          onClick={handleSend}
          size="footer"
          type="button"
          variant="secondary"
        >
          {workspace.isSending ? (
            <LoaderCircleIcon
              className="animate-spin"
              data-icon="inline-start"
            />
          ) : (
            <SendIcon data-icon="inline-start" />
          )}
          {workspace.isSending ? "Sending…" : "Send"}
          <HotkeyHint className="ml-2" command="threadComposer.send" />
        </Button>
        <Button
          aria-label="Discard draft"
          className="border-background border-l"
          disabled={workspace.isBusy}
          onClick={handleDiscard}
          size="footer-icon"
          title="Discard draft"
          type="button"
          variant="secondary"
        >
          <Trash2Icon />
        </Button>
      </div>
    </section>
  );
};

export default MailReplyArea;
