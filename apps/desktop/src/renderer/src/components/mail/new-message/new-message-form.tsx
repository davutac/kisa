import { SparklesIcon } from "lucide-react";
import type { RefObject } from "react";

import AccountPicker from "@/components/accounts/account-picker";
import type { CleanDraftVersion } from "@/components/mail/clean-draft-history";
import type { EmailComposerValue } from "@/components/mail/email-composer";
import EmailRecipientFields from "@/components/mail/email-recipient-fields";
import MailComposer from "@/components/mail/mail-composer";
import type { useComposerFocus } from "@/components/mail/use-composer-focus";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { MAX_GMAIL_SUBJECT_LENGTH } from "@/shared/gmail-subject";
import type { GoogleAccount } from "@/shared/ipc/auth";
import type { MailDraftAttachment } from "@/shared/ipc/mail";
import type {
  ComposerTemplate,
  ComposerTemplateInput,
} from "@/shared/ipc/templates";

import NewMessageFooter from "./new-message-footer";
import type { ScheduledComposerControls } from "./new-message-footer";
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
  onClean: () => Promise<void>;
  onAccountSelect: (accountId: string) => void;
  onComposerChange: (composer: EmailComposerValue) => void;
  onDismissCleanVersion: (version: CleanDraftVersion) => void;
  onSelectCleanVersion: (version: CleanDraftVersion) => void;
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
  onSubjectChange: (subject: string) => void;
  scheduled: ScheduledComposerControls;
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
  onClean,
  onAccountSelect,
  onComposerChange,
  onDismissCleanVersion,
  onSelectCleanVersion,
  onSend,
  onStash,
  selectedAccountId,
  sendShortcutLabel,
  setAttachments,
  onSubjectChange,
  scheduled,
  templates,
}: NewMessageFormProps) => {
  const handleFocusCapture = focus.onFocusCapture;
  const composer = useNewMessageStore((state) => state.composer);
  const cleanHistory = useNewMessageStore((state) => state.cleanHistory);
  const draftId = useNewMessageStore((state) => state.draftId);
  const isSending = useNewMessageStore((state) => state.isSending);
  const isScheduling = useNewMessageStore((state) => state.isScheduling);
  const isBusy = isSending || isScheduling;
  const recipientResetVersion = useNewMessageStore(
    (state) => state.recipientResetVersion
  );
  const recipients = useNewMessageStore((state) => state.recipients);
  const selectedCleanVersionId = useNewMessageStore(
    (state) => state.selectedCleanVersionId
  );
  const subject = useNewMessageStore((state) => state.subject);
  const setRecipients = useNewMessageStore((state) => state.setRecipients);
  const { isEdit } = scheduled;
  const fromAccounts = isEdit
    ? accounts.filter(({ email }) => email === selectedAccountId)
    : accounts;
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
        accounts={fromAccounts}
        enableHotkeys={!isEdit}
        focusRefForAccount={(email) => focus.refFor(`account:${email}`)}
        locked={isEdit}
        onSelect={onAccountSelect}
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
          disabled={isBusy}
          maxLength={MAX_GMAIL_SUBJECT_LENGTH}
          onChange={(event) => onSubjectChange(event.currentTarget.value)}
          ref={focus.refFor("subject")}
          value={subject}
        />
      </InputGroup>
      <MailComposer
        aiActions={[
          {
            command: "composer.clean",
            disabled: !canClean,
            icon: SparklesIcon,
            isWorking: false,
            label: "Clean",
            modelLabel: cleanupModelLabel,
            onClick: () => {
              void onClean();
            },
            workingLabel: "Cleaning…",
          },
        ]}
        ariaLabel="Message"
        attachments={{
          command: "composer.attach",
          files: attachments,
          focusRef: focus.refFor("attachment"),
          inputRef,
          onAdd: addAttachments,
          onRemove: (attachmentId) =>
            setAttachments((current) =>
              current.filter(({ id }) => id !== attachmentId)
            ),
        }}
        className="min-h-40 flex-1 border-0"
        consumeModEnter
        contentKey={draftId}
        defaultValue={composer.html}
        disabled={isBusy}
        enableTemplateSlashMenu
        focusHandleRef={focus.handleRefFor("message")}
        focusAtStart={composer.isEmpty}
        onApplyTemplate={applyTemplate}
        onChange={onComposerChange}
        placeholder="Write a message"
        templateFallbackAccountId={selectedAccountId}
        templateAccounts={accounts}
        templates={templates}
        history={{
          onDismiss: onDismissCleanVersion,
          onSelect: onSelectCleanVersion,
          selectedVersionId: selectedCleanVersionId,
          versions: cleanHistory,
        }}
      />
      <NewMessageFooter
        canSend={canSend}
        canStash={canStash}
        isScheduling={isScheduling}
        isSending={isSending}
        key={draftId}
        onSend={onSend}
        onStash={onStash}
        scheduled={scheduled}
        sendShortcutLabel={sendShortcutLabel}
      />
    </form>
  );
};

export default NewMessageForm;
