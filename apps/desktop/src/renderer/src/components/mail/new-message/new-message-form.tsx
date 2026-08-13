import {
  ArchiveIcon,
  LoaderCircleIcon,
  SendIcon,
  SparklesIcon,
} from "lucide-react";
import type { RefObject } from "react";

import AccountPicker from "@/components/accounts/account-picker";
import AiComposerButton from "@/components/mail/ai-composer-button";
import EmailComposer from "@/components/mail/email-composer";
import EmailRecipientFields from "@/components/mail/email-recipient-fields";
import {
  NewMessageAttachmentButton,
  NewMessageAttachmentList,
} from "@/components/mail/new-message-attachments";
import type { useComposerFocus } from "@/components/mail/use-composer-focus";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { getHotkeyAriaLabel, HotkeyHint, useAppCommand } from "@/hotkeys";
import { MAX_GMAIL_SUBJECT_LENGTH } from "@/shared/gmail-subject";
import type { GoogleAccount } from "@/shared/ipc/auth";
import type { MailDraftAttachment } from "@/shared/ipc/mail";
import type {
  ComposerTemplate,
  ComposerTemplateInput,
} from "@/shared/ipc/templates";

import { useNewMessageStore } from "./new-message-store";

interface NewMessageFormProps {
  accounts: readonly GoogleAccount[];
  addAttachments: (files: FileList | null) => void;
  applyTemplate: (template: ComposerTemplateInput) => void;
  attachments: readonly MailDraftAttachment[];
  canClean: boolean;
  canSend: boolean;
  canStash: boolean;
  cleanupModelLabel: string;
  focus: ReturnType<typeof useComposerFocus>;
  inputRef: RefObject<HTMLInputElement | null>;
  isCleaning: boolean;
  onClean: () => Promise<void>;
  onSend: () => Promise<void>;
  onStash: () => void;
  selectedAccountId: string;
  sendShortcutLabel: string;
  setAttachments: (
    update:
      | readonly MailDraftAttachment[]
      | ((
          current: readonly MailDraftAttachment[]
        ) => readonly MailDraftAttachment[])
  ) => void;
  templates: readonly ComposerTemplate[];
}

const NewMessageForm = ({
  accounts,
  addAttachments,
  applyTemplate,
  attachments,
  canClean,
  canSend,
  canStash,
  cleanupModelLabel,
  focus,
  inputRef,
  isCleaning,
  onClean,
  onSend,
  onStash,
  selectedAccountId,
  sendShortcutLabel,
  setAttachments,
  templates,
}: NewMessageFormProps) => {
  const handleFocusCapture = focus.onFocusCapture;
  const composer = useNewMessageStore((state) => state.composer);
  const draftId = useNewMessageStore((state) => state.draftId);
  const isSending = useNewMessageStore((state) => state.isSending);
  const recipientResetVersion = useNewMessageStore(
    (state) => state.recipientResetVersion
  );
  const recipients = useNewMessageStore((state) => state.recipients);
  const subject = useNewMessageStore((state) => state.subject);
  const setAccountId = useNewMessageStore((state) => state.setAccountId);
  const setComposer = useNewMessageStore((state) => state.setComposer);
  const setRecipients = useNewMessageStore((state) => state.setRecipients);
  const setSubject = useNewMessageStore((state) => state.setSubject);
  const isBusy = isCleaning || isSending;

  useAppCommand("composer.attach", () => inputRef.current?.click(), {
    enabled: !isBusy,
  });

  return (
    <form
      className="bg-background flex min-h-0 flex-1 flex-col gap-px overflow-hidden"
      onFocusCapture={handleFocusCapture}
      onSubmit={(event) => {
        event.preventDefault();
        void onSend();
      }}
    >
      <AccountPicker
        accounts={accounts}
        enableHotkeys
        focusRefForAccount={(email) => focus.refFor(`account:${email}`)}
        onSelect={setAccountId}
        selectedAccountId={selectedAccountId}
      />
      <EmailRecipientFields
        accountId={selectedAccountId}
        className="shrink-0"
        inputRefs={{
          bcc: focus.refFor("bcc"),
          cc: focus.refFor("cc"),
          to: focus.refFor("to"),
        }}
        onChange={setRecipients}
        resetKey={`${draftId}:${recipientResetVersion}`}
        value={recipients}
      />
      <InputGroup className="bg-card dark:bg-card h-9 shrink-0 rounded-none border-0 px-4 shadow-none has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0">
        <InputGroupAddon className="w-10 justify-start p-0">
          <label htmlFor="new-message-subject">Subject</label>
        </InputGroupAddon>
        <InputGroupInput
          className="h-8 px-0 text-sm md:text-sm"
          id="new-message-subject"
          disabled={isCleaning}
          maxLength={MAX_GMAIL_SUBJECT_LENGTH}
          onChange={(event) => setSubject(event.currentTarget.value)}
          ref={focus.refFor("subject")}
          value={subject}
        />
      </InputGroup>
      <EmailComposer
        ariaLabel="Message"
        className="min-h-40 flex-1 border-0"
        consumeModEnter
        contentKey={draftId}
        defaultValue={composer.html}
        disabled={isCleaning}
        enableTemplateSlashMenu
        focusHandleRef={focus.handleRefFor("message")}
        onApplyTemplate={applyTemplate}
        onChange={setComposer}
        placeholder="Write a message"
        templateFallbackAccountId={selectedAccountId}
        templateAccounts={accounts}
        templates={templates}
        toolbarActions={
          <>
            <AiComposerButton
              command="composer.clean"
              disabled={!canClean}
              icon={SparklesIcon}
              isWorking={isCleaning}
              label="Clean"
              modelLabel={cleanupModelLabel}
              onClick={() => {
                void onClean();
              }}
              workingLabel="Cleaning…"
            />
            <NewMessageAttachmentButton
              disabled={isBusy}
              focusRef={focus.refFor("attachment")}
              inputRef={inputRef}
              onFiles={addAttachments}
            />
          </>
        }
      />
      <NewMessageAttachmentList
        attachments={attachments}
        onRemove={(attachmentId) =>
          setAttachments((current) =>
            current.filter(({ id }) => id !== attachmentId)
          )
        }
      />
      <div className="bg-background flex shrink-0 items-stretch gap-0">
        <Button
          aria-label="Stash draft"
          aria-keyshortcuts={getHotkeyAriaLabel("composer.stash")}
          className="border-background border-r"
          disabled={!canStash}
          onClick={onStash}
          onMouseDown={(event) => event.preventDefault()}
          size="footer-icon"
          title="Stash draft"
          type="button"
          variant="secondary"
        >
          <ArchiveIcon />
        </Button>
        <Button
          aria-keyshortcuts={getHotkeyAriaLabel("composer.send")}
          className="relative"
          disabled={!canSend}
          size="footer"
          title={sendShortcutLabel}
          type="submit"
          variant="secondary"
        >
          {isSending ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : (
            <SendIcon />
          )}
          {isSending ? "Sending…" : "Send"}
          <HotkeyHint className="absolute right-4" command="composer.send" />
        </Button>
      </div>
    </form>
  );
};

export default NewMessageForm;
