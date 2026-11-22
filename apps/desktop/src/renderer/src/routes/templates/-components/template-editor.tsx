import { Trash2Icon } from "lucide-react";

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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { quietDestructiveClassName } from "@/lib/action-hierarchy";
import { cn } from "@/lib/utils";
import type { Account } from "@/shared/ipc/accounts";
import type { ComposerTemplateInput } from "@/shared/ipc/templates";
import type { TemplateVariableContext } from "@/shared/template-variables";
import TemplateSubjectEditor from "@/templates/template-subject-editor";

/**
 * Save lives in the page titlebar, a portal outside this form, so it names
 * the form by id. That keeps Enter in the name field submitting the form.
 */
export const TEMPLATE_EDITOR_FORM_ID = "template-editor";

const FIELD_GROUP_FOCUS_RESET =
  "shadow-none has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0 has-[[data-slot][aria-invalid=true]]:border-transparent has-[[data-slot][aria-invalid=true]]:ring-0 dark:has-[[data-slot][aria-invalid=true]]:ring-0";

interface TemplateEditorProps {
  readonly accounts: readonly Account[];
  readonly draft: ComposerTemplateInput;
  readonly editorVersion: number;
  readonly isCreating: boolean;
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

/**
 * A template laid out like an open conversation: a stack of cards inset from
 * the page, with the name as the header's title and Delete beside it where a
 * thread keeps Trash, then From, the recipients, Subject, and the body.
 */
const TemplateEditor = ({
  accounts,
  draft,
  editorVersion,
  isCreating,
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
  const contentKey = `${draft.id}:${editorVersion}`;

  return (
    <form
      className="flex min-w-0 flex-1 flex-col gap-px overflow-hidden px-2 pt-1 pb-2"
      id={TEMPLATE_EDITOR_FORM_ID}
      onSubmit={(event) => {
        event.preventDefault();
        void onSave();
      }}
    >
      <div className="bg-card flex min-w-0 shrink-0 items-center gap-2 rounded-t-lg py-3 pr-3 pl-4">
        <InputGroup
          className={cn(
            "h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent dark:bg-transparent",
            FIELD_GROUP_FOCUS_RESET
          )}
        >
          <InputGroupInput
            aria-describedby={
              nameError === undefined ? undefined : "template-name-error"
            }
            aria-invalid={nameError === undefined ? undefined : true}
            aria-label="Name"
            autoFocus={isCreating}
            className="aria-invalid:text-destructive placeholder:text-muted-foreground h-8 px-0 text-lg font-semibold aria-invalid:border-0 md:text-lg"
            id="template-name"
            onChange={(event) => onNameChange(event.currentTarget.value)}
            placeholder="Template name"
            value={draft.name}
          />
          {nameError === undefined ? null : (
            <InputGroupAddon align="inline-end" className="p-0">
              <FieldErrorIndicator
                id="template-name-error"
                message={nameError}
              />
            </InputGroupAddon>
          )}
        </InputGroup>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="Delete template"
                className={quietDestructiveClassName}
                disabled={isCreating || isSaving}
                onClick={onDelete}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Trash2Icon />
              </Button>
            }
          />
          <TooltipContent side="bottom">Delete template</TooltipContent>
        </Tooltip>
      </div>
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
      {/* `email-composer` scopes the variable-chip styles to this row. */}
      <InputGroup
        className={cn(
          "email-composer bg-card dark:bg-card h-9 shrink-0 rounded-none border-0 px-4",
          FIELD_GROUP_FOCUS_RESET
        )}
      >
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
        className="min-h-48 flex-1 rounded-b-lg border-0"
        contentKey={contentKey}
        defaultValue={draft.body.html}
        enableTemplateVariables
        onChange={onBodyChange}
        placeholder="Write the template body"
        templateVariablePreviewContext={variablePreviewContext}
      />
    </form>
  );
};

export default TemplateEditor;
