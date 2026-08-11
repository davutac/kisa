import { LoaderCircleIcon, PlusIcon, SaveIcon, Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";

import AccountPicker from "@/components/accounts/account-picker";
import FieldErrorIndicator from "@/components/forms/field-error-indicator";
import EmailComposer from "@/components/mail/email-composer";
import type { EmailComposerValue } from "@/components/mail/email-composer";
import EmailRecipientFields from "@/components/mail/email-recipient-fields";
import type { EmailRecipients } from "@/components/mail/email-recipient-fields";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { getHotkeyAriaLabel, getHotkeyDisplay } from "@/hotkeys";
import type { GoogleAccount } from "@/shared/ipc/auth";
import type { ComposerTemplateInput } from "@/shared/ipc/templates";
import type { TemplateVariableContext } from "@/shared/template-variables";
import TemplateSubjectEditor from "@/templates/template-subject-editor";

interface TemplateEditorProps {
  readonly accounts: readonly GoogleAccount[];
  readonly draft: ComposerTemplateInput;
  readonly editorVersion: number;
  readonly isCreating: boolean;
  readonly isDirty: boolean;
  readonly isSaving: boolean;
  readonly nameError?: string;
  readonly onAccountChange: (accountId: string | null) => void;
  readonly onBodyChange: (body: EmailComposerValue) => void;
  readonly onDelete: () => void;
  readonly onNameChange: (name: string) => void;
  readonly onRecipientsChange: (recipients: EmailRecipients) => void;
  readonly onSave: () => Promise<void>;
  readonly onSubjectChange: (subject: string) => void;
  readonly variablePreviewContext: Omit<TemplateVariableContext, "now">;
}

const getSaveAction = ({
  isCreating,
  isDirty,
  isSaving,
}: {
  isCreating: boolean;
  isDirty: boolean;
  isSaving: boolean;
}): { icon: ReactNode; label: string; status: string } => {
  if (isSaving) {
    return {
      icon: <LoaderCircleIcon className="animate-spin" />,
      label: isCreating ? "Adding…" : "Saving…",
      status: isCreating ? "Adding template" : "Saving changes",
    };
  }
  return {
    icon: isCreating ? <PlusIcon /> : <SaveIcon />,
    label: isCreating ? "Add" : "Save",
    status: isDirty ? "Unsaved changes" : "Saved",
  };
};

const TemplateEditor = ({
  accounts,
  draft,
  editorVersion,
  isCreating,
  isDirty,
  isSaving,
  nameError,
  onAccountChange,
  onBodyChange,
  onDelete,
  onNameChange,
  onRecipientsChange,
  onSave,
  onSubjectChange,
  variablePreviewContext,
}: TemplateEditorProps) => {
  const saveAction = getSaveAction({ isCreating, isDirty, isSaving });
  const saveDisplay = getHotkeyDisplay("templates.save");
  const contentKey = `${draft.id}:${editorVersion}`;

  return (
    <form
      className="bg-background flex min-w-0 flex-1 flex-col gap-px overflow-hidden rounded-xl"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave();
      }}
    >
      <InputGroup className="bg-card dark:bg-card h-9 shrink-0 rounded-none border-0 px-4 shadow-none has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0 has-[[data-slot][aria-invalid=true]]:border-transparent has-[[data-slot][aria-invalid=true]]:ring-0 dark:has-[[data-slot][aria-invalid=true]]:ring-0">
        <InputGroupAddon className="w-10 justify-start p-0">
          <label htmlFor="template-name">Name</label>
        </InputGroupAddon>
        <InputGroupInput
          aria-describedby={
            nameError === undefined ? undefined : "template-name-error"
          }
          aria-invalid={nameError === undefined ? undefined : true}
          aria-label="Name"
          autoFocus={isCreating}
          className="aria-invalid:text-destructive h-8 px-0 text-sm aria-invalid:border-0 md:text-sm"
          id="template-name"
          onChange={(event) => onNameChange(event.currentTarget.value)}
          value={draft.name}
        />
        {nameError === undefined ? null : (
          <InputGroupAddon align="inline-end" className="p-0">
            <FieldErrorIndicator id="template-name-error" message={nameError} />
          </InputGroupAddon>
        )}
      </InputGroup>
      <AccountPicker
        accounts={accounts}
        nullOption={{
          description: "Use the account selected in New email",
          label: "Keep current account",
        }}
        onSelect={onAccountChange}
        selectedAccountId={draft.accountId}
      />
      <EmailRecipientFields
        accountId={draft.accountId ?? ""}
        className="shrink-0"
        onChange={onRecipientsChange}
        resetKey={contentKey}
        value={{ bcc: draft.bcc, cc: draft.cc, to: draft.to }}
      />
      <InputGroup className="email-composer bg-card dark:bg-card h-9 shrink-0 rounded-none border-0 px-4 shadow-none has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0">
        <InputGroupAddon
          className="mr-2 w-10 justify-start p-0"
          onClick={(event) =>
            event.currentTarget.parentElement
              ?.querySelector<HTMLElement>('[contenteditable="true"]')
              ?.focus()
          }
        >
          <span id="template-subject-label">Subject</span>
        </InputGroupAddon>
        <TemplateSubjectEditor
          contentKey={contentKey}
          defaultValue={draft.subject}
          onChange={onSubjectChange}
          previewContext={variablePreviewContext}
        />
      </InputGroup>
      <EmailComposer
        ariaLabel="Template body"
        className="min-h-48 flex-1 border-0"
        contentKey={contentKey}
        defaultValue={draft.body.html}
        enableTemplateVariables
        onChange={onBodyChange}
        placeholder="Write the template body"
        templateVariablePreviewContext={variablePreviewContext}
      />
      <div className="bg-background flex shrink-0 items-stretch gap-px">
        <Button
          aria-label="Delete template"
          disabled={isCreating || isSaving}
          onClick={onDelete}
          size="footer-icon"
          title="Delete template"
          type="button"
          variant="secondary"
        >
          <Trash2Icon />
        </Button>
        <Button
          aria-keyshortcuts={getHotkeyAriaLabel("templates.save")}
          className="relative"
          disabled={!isDirty || isSaving}
          size="footer"
          title={`${saveDisplay.label} (${saveDisplay.bindings[0]})`}
          type="submit"
          variant="secondary"
        >
          {saveAction.icon}
          {saveAction.label}
          <span className="text-muted-foreground absolute right-4 text-xs font-normal">
            {saveAction.status}
          </span>
        </Button>
      </div>
    </form>
  );
};

export default TemplateEditor;
