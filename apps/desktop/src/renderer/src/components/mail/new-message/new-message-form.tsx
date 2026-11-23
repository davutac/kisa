import { SparklesIcon } from "lucide-react";

import AccountPicker from "@/components/accounts/account-picker";
import type { CleanDraftVersion } from "@/components/mail/clean-draft-history";
import type { EmailComposerValue } from "@/components/mail/email-composer";
import EmailRecipientFields from "@/components/mail/email-recipient-fields";
import MailComposer from "@/components/mail/mail-composer";
import type { OutgoingAttachmentComposerController } from "@/components/mail/outgoing-attachments";
import type { useComposerFocus } from "@/components/mail/use-composer-focus";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import type { Account } from "@/shared/ipc/accounts";
import type {
  ComposerTemplate,
  ComposerTemplateInput,
} from "@/shared/ipc/templates";
import { MAX_SUBJECT_LENGTH } from "@/shared/mail-subject";

import type { ScheduledComposerControls } from "./new-message-footer";
import { useNewMessageStore } from "./new-message-store";

/**
 * From and the recipients are quiet rows on the page itself, divided by
 * hairlines, so the subject and message read as the document.
 */
const PAGE_ROW_CLASS =
  "min-h-10 border-b border-border bg-transparent dark:bg-transparent has-[[data-slot=input-group-control]:focus-visible]:border-border has-[[data-slot][aria-invalid=true]]:border-border";

/** The subject is the page's headline, set above the message it titles. */
const SUBJECT_GROUP_CLASS =
  "h-auto shrink-0 rounded-none border-0 bg-transparent px-4 pt-7 pb-1 shadow-none dark:bg-transparent has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0";

interface NewMessageFormProps {
  accounts: readonly Account[];
  applyTemplate: (template: ComposerTemplateInput) => void;
  canClean: boolean;
  cleanupModelLabel: string;
  focus: ReturnType<typeof useComposerFocus>;
  onClean: () => Promise<void>;
  onAccountSelect: (accountId: string) => void;
  onComposerChange: (composer: EmailComposerValue) => void;
  onDismissCleanVersion: (version: CleanDraftVersion) => void;
  onSelectCleanVersion: (version: CleanDraftVersion) => void;
  onSend: () => Promise<void>;
  selectedAccountId: string;
  outgoingAttachments: OutgoingAttachmentComposerController;
  onSubjectChange: (subject: string) => void;
  scheduled: ScheduledComposerControls;
  templates: readonly ComposerTemplate[];
}

const NewMessageForm = ({
  accounts,
  applyTemplate,
  canClean,
  cleanupModelLabel,
  focus,
  onClean,
  onAccountSelect,
  onComposerChange,
  onDismissCleanVersion,
  onSelectCleanVersion,
  onSend,
  selectedAccountId,
  outgoingAttachments,
  onSubjectChange,
  scheduled,
  templates,
}: NewMessageFormProps) => {
  const handleFocusCapture = focus.onFocusCapture;
  const composer = useNewMessageStore((state) => state.composer);
  const cleanHistory = useNewMessageStore((state) => state.cleanHistory);
  const draftId = useNewMessageStore((state) => state.draftId);
  const isBusy = useNewMessageStore(
    (state) => state.isSending || state.isScheduling
  );
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
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      onFocusCapture={handleFocusCapture}
      onSubmit={(event) => {
        event.preventDefault();
        void onSend();
      }}
    >
      <AccountPicker
        accounts={fromAccounts}
        className={PAGE_ROW_CLASS}
        enableHotkeys={!isEdit}
        focusRefForAccount={(email) => focus.refFor(`account:${email}`)}
        locked={isEdit}
        onSelect={onAccountSelect}
        selectedAccountId={selectedAccountId}
      />
      <EmailRecipientFields
        accountId={selectedAccountId}
        className="shrink-0"
        fieldClassName={PAGE_ROW_CLASS}
        inputRefs={{
          bcc: focus.refFor("bcc"),
          cc: focus.refFor("cc"),
          to: focus.refFor("to"),
        }}
        onChange={setRecipients}
        resetKey={`${draftId}:${recipientResetVersion}`}
        value={recipients}
      />
      <InputGroup className={SUBJECT_GROUP_CLASS}>
        {/* The headline needs no visible label; a hidden addon would still
            indent the input, so it is named directly. */}
        <InputGroupInput
          aria-label="Subject"
          className="placeholder:text-muted-foreground h-auto px-0 py-0 text-xl leading-snug font-semibold tracking-tight md:text-xl"
          id="new-message-subject"
          disabled={isBusy}
          maxLength={MAX_SUBJECT_LENGTH}
          onChange={(event) => onSubjectChange(event.currentTarget.value)}
          placeholder="Subject"
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
          controller: outgoingAttachments,
          focusRef: focus.refFor("attachment"),
          listClassName: "bg-transparent",
        }}
        className="divide-border min-h-40 flex-1 border-0 bg-transparent"
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
    </form>
  );
};

export default NewMessageForm;
