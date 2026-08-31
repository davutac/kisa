import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import { mailDrafts } from "@repo/database/schemas";
import type { StoredMailDraftAttachment } from "@repo/database/schemas";

import type { MailDraftInput } from "../../shared/ipc/mail";

const toStoredSignature = (draft: MailDraftInput) =>
  draft.signature === undefined
    ? {
        signatureAccountEmail: null,
        signatureHtml: null,
        signatureText: null,
      }
    : {
        signatureAccountEmail: draft.signature.accountId,
        signatureHtml: draft.signature.body.html,
        signatureText: draft.signature.body.text,
      };

export const toScheduledDraftValues = (
  draft: MailDraftInput,
  attachments: readonly StoredMailDraftAttachment[],
  createdAt: number,
  updatedAt: number
): typeof mailDrafts.$inferInsert => ({
  accountEmail: draft.accountId ?? null,
  attachments,
  bcc: draft.bcc,
  bodyHtml: draft.body.html,
  bodyText: draft.body.text,
  cc: draft.cc,
  createdAt,
  id: draft.id,
  kind: draft.kind,
  messageId: draft.messageId,
  ...toStoredSignature(draft),
  subject: draft.subject,
  threadId: draft.threadId,
  to: draft.to,
  updatedAt,
});

export const upsertScheduledDraft = async (
  database: Pick<RemoteDatabaseClient, "insert">,
  values: typeof mailDrafts.$inferInsert
): Promise<void> => {
  await database
    .insert(mailDrafts)
    .values(values)
    .onConflictDoUpdate({
      set: {
        accountEmail: values.accountEmail,
        attachments: values.attachments,
        bcc: values.bcc,
        bodyHtml: values.bodyHtml,
        bodyText: values.bodyText,
        cc: values.cc,
        kind: values.kind,
        messageId: values.messageId,
        signatureAccountEmail: values.signatureAccountEmail,
        signatureHtml: values.signatureHtml,
        signatureText: values.signatureText,
        subject: values.subject,
        threadId: values.threadId,
        to: values.to,
        updatedAt: values.updatedAt,
      },
      target: mailDrafts.id,
    })
    .run();
};
