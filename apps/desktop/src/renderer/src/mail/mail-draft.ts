import type { EmailRecipients } from "@/components/mail/email-recipient-fields";
import {
  appendEmailSignatureBody,
  createEmailSignatureBody,
  EMPTY_EMAIL_SIGNATURE_BODY,
  hasEmailSignature,
  removeEmailSignature,
} from "@/shared/email-signature";
import type { EmailSignatureBody } from "@/shared/email-signature";
import type {
  MailDraftInput,
  MailDraftKind,
  MailDraftSignature,
} from "@/shared/ipc/mail";

const sameAddresses = (
  left: readonly string[],
  right: readonly string[]
): boolean =>
  left.length === right.length &&
  left.every((address, index) => address === right[index]);

const bodyWithoutAutomaticSignature = (draft: MailDraftInput) =>
  draft.signature === undefined
    ? draft.body
    : removeEmailSignature(draft.body, draft.signature.body);

const isDraftBodyEmpty = (draft: MailDraftInput): boolean =>
  bodyWithoutAutomaticSignature(draft).text.trim().length === 0;

const createDraftSignature = (
  accountId: string,
  configuredSignature: EmailSignatureBody
): MailDraftSignature | undefined => {
  const body = createEmailSignatureBody(configuredSignature);
  return body === undefined ? undefined : { accountId, body };
};

const createDraftSignatureContent = (
  accountId: string,
  configuredSignature: EmailSignatureBody
) => {
  const signature = createDraftSignature(accountId, configuredSignature);
  return {
    body:
      signature === undefined
        ? { html: "", text: "" }
        : appendEmailSignatureBody({ html: "", text: "" }, signature.body),
    signature,
  };
};

export const toMailDraftComposerValue = (draft: MailDraftInput) => ({
  html: draft.body.html,
  isEmpty: isDraftBodyEmpty(draft),
  text: draft.body.text,
});

export const updateMailDraftBody = (
  draft: MailDraftInput,
  body: MailDraftInput["body"]
): MailDraftInput => ({
  ...draft,
  body,
  signature:
    draft.signature !== undefined &&
    hasEmailSignature(body, draft.signature.body)
      ? draft.signature
      : undefined,
});

export const isDraftBodyOnlySignature = (draft: MailDraftInput): boolean =>
  draft.signature !== undefined &&
  hasEmailSignature(draft.body, draft.signature.body) &&
  isDraftBodyEmpty(draft);

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

export const createNewMailDraft = (
  accountId?: string,
  configuredSignature: EmailSignatureBody = EMPTY_EMAIL_SIGNATURE_BODY
): MailDraftInput => {
  const signatureContent =
    accountId === undefined
      ? { body: { html: "", text: "" }, signature: undefined }
      : createDraftSignatureContent(accountId, configuredSignature);
  const draft = {
    attachments: [],
    bcc: [],
    ...signatureContent,
    cc: [],
    id: crypto.randomUUID(),
    kind: "new",
    subject: "",
    to: [],
  } as const;

  return accountId === undefined ? draft : { ...draft, accountId };
};

export const createThreadMailDraft = (input: {
  readonly accountId: string;
  readonly action: Exclude<MailDraftKind, "new">;
  readonly messageId: string;
  readonly recipients: EmailRecipients;
  readonly signature?: EmailSignatureBody;
  readonly threadId: string;
}): MailDraftInput => {
  const signatureContent = createDraftSignatureContent(
    input.accountId,
    input.signature ?? EMPTY_EMAIL_SIGNATURE_BODY
  );

  return {
    accountId: input.accountId,
    attachments: [],
    bcc: input.recipients.bcc,
    ...signatureContent,
    cc: input.recipients.cc,
    id: crypto.randomUUID(),
    kind: input.action,
    messageId: input.messageId,
    subject: "",
    threadId: input.threadId,
    to: input.recipients.to,
  };
};

export const changeNewMailDraftAccount = (
  draft: MailDraftInput,
  accountId: string,
  configuredSignature: EmailSignatureBody,
  previousConfiguredSignature: EmailSignatureBody = EMPTY_EMAIL_SIGNATURE_BODY
): MailDraftInput => {
  const nextSignature = createDraftSignature(accountId, configuredSignature);
  const canReplaceSignature =
    draft.signature !== undefined &&
    hasEmailSignature(draft.body, draft.signature.body);
  const shouldAddFirstSignature =
    draft.signature === undefined &&
    createEmailSignatureBody(previousConfiguredSignature) === undefined;
  const body = canReplaceSignature
    ? removeEmailSignature(draft.body, draft.signature.body)
    : draft.body;
  const shouldApplySignature = canReplaceSignature || shouldAddFirstSignature;

  return {
    ...draft,
    accountId,
    body:
      shouldApplySignature && nextSignature !== undefined
        ? appendEmailSignatureBody(body, nextSignature.body)
        : body,
    signature: shouldApplySignature ? nextSignature : undefined,
  };
};
