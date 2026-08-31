import { Effect, Schema } from "effect";

import {
  hasEmailSignature,
  removeEmailSignature,
} from "../../shared/email-signature";
import { GmailOutgoingSubject } from "../../shared/ipc/mail";
import type { MailDraftInput } from "../../shared/ipc/mail";
import type { ScheduledMailKey } from "../../shared/ipc/scheduled-mail";
import { parseMailbox } from "./gmail-payload";
import { scheduledMailError } from "./scheduled-mail-error";

const isGmailOutgoingSubject = Schema.is(GmailOutgoingSubject);

export const isValidScheduledDraft = (
  key: ScheduledMailKey,
  draft: MailDraftInput
): boolean =>
  draft.id === key.draftId &&
  draft.accountId === key.accountId &&
  draft.kind === "new" &&
  draft.threadId === undefined &&
  draft.messageId === undefined &&
  (draft.signature === undefined ||
    (draft.signature.accountId === key.accountId &&
      hasEmailSignature(draft.body, draft.signature.body)));

export const normalizeValidScheduledDeliveryDraft = Effect.fn(
  "ScheduledMailDraftValidation.normalize"
)(function* normalizeValidScheduledDeliveryDraft(
  key: ScheduledMailKey,
  draft: MailDraftInput
) {
  if (!isValidScheduledDraft(key, draft)) {
    return yield* scheduledMailError(
      "The scheduled draft does not match its account"
    );
  }

  const recipients = [...draft.to, ...draft.cc, ...draft.bcc];
  if (recipients.length === 0) {
    return yield* scheduledMailError(
      "Add at least one recipient before scheduling"
    );
  }
  const invalidRecipient = recipients.find(
    (recipient) => parseMailbox(recipient) === undefined
  );
  if (invalidRecipient !== undefined) {
    return yield* scheduledMailError(
      `Invalid recipient address: ${invalidRecipient}`
    );
  }

  const subject = draft.subject.trim();
  if (subject.length === 0) {
    return yield* scheduledMailError("Add a subject before scheduling");
  }
  if (!isGmailOutgoingSubject(subject)) {
    return yield* scheduledMailError("The subject is too long");
  }

  const authoredBody =
    draft.signature === undefined
      ? draft.body
      : removeEmailSignature(draft.body, draft.signature.body);
  if (authoredBody.text.trim().length === 0) {
    return yield* scheduledMailError("Add a message before scheduling");
  }

  return subject === draft.subject ? draft : { ...draft, subject };
});
