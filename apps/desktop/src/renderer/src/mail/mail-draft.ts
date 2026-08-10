import type { EmailRecipients } from "@/components/mail/email-recipient-fields";
import type { MailDraftInput, MailDraftKind } from "@/shared/ipc/mail";

const sameAddresses = (
  left: readonly string[],
  right: readonly string[]
): boolean =>
  left.length === right.length &&
  left.every((address, index) => address === right[index]);

const isDraftBodyEmpty = (draft: MailDraftInput): boolean =>
  draft.body.text.trim().length === 0;

export const getDraftBodyPreview = (text: string): string =>
  text.trim().replaceAll(/\s+/gu, " ");

export const getDraftResumeFocusTarget = (
  draft: MailDraftInput
): "message" | "subject" | "to" => {
  if (draft.to.length === 0) {
    return "to";
  }
  if (draft.subject.trim().length === 0) {
    return "subject";
  }
  return "message";
};

export const isNewMailDraftEmpty = (draft: MailDraftInput): boolean =>
  draft.attachments.length === 0 &&
  draft.bcc.length === 0 &&
  draft.cc.length === 0 &&
  isDraftBodyEmpty(draft) &&
  draft.subject.trim().length === 0 &&
  draft.to.length === 0;

export const getNewMailStashCommandAction = (
  draft: MailDraftInput,
  hasStashes: boolean
): "none" | "open-picker" | "stash" => {
  if (!isNewMailDraftEmpty(draft)) {
    return "stash";
  }

  return hasStashes ? "open-picker" : "none";
};

export const isThreadMailDraftEmpty = (
  draft: MailDraftInput,
  initialRecipients: EmailRecipients
): boolean =>
  draft.attachments.length === 0 &&
  isDraftBodyEmpty(draft) &&
  draft.subject.trim().length === 0 &&
  sameAddresses(draft.bcc, initialRecipients.bcc) &&
  sameAddresses(draft.cc, initialRecipients.cc) &&
  sameAddresses(draft.to, initialRecipients.to);

export const createNewMailDraft = (accountId?: string): MailDraftInput => ({
  ...(accountId === undefined ? {} : { accountId }),
  attachments: [],
  bcc: [],
  body: { html: "", text: "" },
  cc: [],
  id: crypto.randomUUID(),
  kind: "new",
  subject: "",
  to: [],
});

export const createThreadMailDraft = (input: {
  readonly accountId: string;
  readonly action: Exclude<MailDraftKind, "new">;
  readonly messageId: string;
  readonly recipients: EmailRecipients;
  readonly threadId: string;
}): MailDraftInput => ({
  accountId: input.accountId,
  attachments: [],
  bcc: input.recipients.bcc,
  body: { html: "", text: "" },
  cc: input.recipients.cc,
  id: crypto.randomUUID(),
  kind: input.action,
  messageId: input.messageId,
  subject: "",
  threadId: input.threadId,
  to: input.recipients.to,
});
