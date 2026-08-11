import type { MailDraftAttachment } from "@/shared/ipc/mail";
import type {
  ComposerTemplateBody,
  ComposerTemplateInput,
} from "@/shared/ipc/templates";
import type { TemplateVariableContext } from "@/shared/template-variables";

interface ComposerTemplateApplicationState {
  readonly accountId: string;
  readonly attachments: readonly MailDraftAttachment[];
  readonly bcc: readonly string[];
  readonly body: ComposerTemplateBody;
  readonly cc: readonly string[];
  readonly subject: string;
  readonly to: readonly string[];
}

export const applyComposerTemplate = (
  current: ComposerTemplateApplicationState,
  template: ComposerTemplateInput
): ComposerTemplateApplicationState => ({
  accountId: template.accountId ?? current.accountId,
  attachments: current.attachments,
  bcc: template.bcc,
  body: template.body,
  cc: template.cc,
  subject: template.subject,
  to: template.to,
});

export const createTemplateVariableContext = (
  currentAccountId: string,
  template: ComposerTemplateInput,
  now: number
): TemplateVariableContext => ({
  accountEmail: template.accountId ?? currentAccountId,
  now,
  ...(template.to.length === 1 ? { toEmail: template.to[0] } : {}),
});
