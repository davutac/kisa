import { truncateGmailSubject } from "@/shared/gmail-subject";
import type { GoogleAccount } from "@/shared/ipc/auth";
import type {
  ComposerTemplate,
  ComposerTemplateInput,
} from "@/shared/ipc/templates";
import type { TemplateVariableContext } from "@/shared/template-variables";

export const createEmptyTemplate = (): ComposerTemplateInput => ({
  accountId: null,
  bcc: [],
  body: { html: "", text: "" },
  cc: [],
  id: crypto.randomUUID(),
  name: "",
  subject: "",
  to: [],
});

export const toTemplateInput = (
  template: ComposerTemplate,
  accountIds: ReadonlySet<string>
): ComposerTemplateInput => ({
  accountId:
    template.accountId === null || accountIds.has(template.accountId)
      ? template.accountId
      : null,
  bcc: template.bcc,
  body: template.body,
  cc: template.cc,
  id: template.id,
  name: template.name,
  subject: truncateGmailSubject(template.subject),
  to: template.to,
});

const stringArraysAreEqual = (
  left: readonly string[],
  right: readonly string[]
): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

export const templatesAreEqual = (
  left: ComposerTemplateInput,
  right: ComposerTemplateInput
): boolean =>
  left.accountId === right.accountId &&
  stringArraysAreEqual(left.bcc, right.bcc) &&
  left.body.html === right.body.html &&
  left.body.text === right.body.text &&
  stringArraysAreEqual(left.cc, right.cc) &&
  left.id === right.id &&
  left.name === right.name &&
  left.subject === right.subject &&
  stringArraysAreEqual(left.to, right.to);

export const getTemplateSummary = (template: ComposerTemplate): string =>
  template.subject ||
  template.body.text.trim().replaceAll(/\s+/gu, " ").slice(0, 100) ||
  "Empty template";

export const getVariablePreviewContext = (
  template: ComposerTemplateInput,
  accounts: readonly Pick<GoogleAccount, "displayName" | "email">[]
): Omit<TemplateVariableContext, "now"> => {
  const accountName =
    template.accountId === null
      ? undefined
      : accounts.find(({ email }) => email === template.accountId)?.displayName;
  const context =
    template.accountId === null ? {} : { accountEmail: template.accountId };
  const contextWithName =
    accountName === undefined ? context : { ...context, accountName };

  return template.to.length === 1
    ? { ...contextWithName, toEmail: template.to[0] }
    : contextWithName;
};

export const getTemplateNameError = (
  draft: ComposerTemplateInput,
  templates: readonly ComposerTemplate[]
): string | undefined => {
  const name = draft.name.trim();
  if (name.length === 0) {
    return "Name is required";
  }
  if (
    templates.some(
      (template) =>
        template.id !== draft.id &&
        template.name.trim().localeCompare(name, undefined, {
          sensitivity: "base",
        }) === 0
    )
  ) {
    return "Name must be unique";
  }
  return undefined;
};
