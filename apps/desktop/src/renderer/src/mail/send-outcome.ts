import type { MailSendOutcome } from "@/shared/ipc/mail";

export interface SendOutcomeNotice {
  readonly message: string;
  readonly tone: "success" | "warning";
}

/**
 * What to tell the user once a message has gone out. A server can accept a
 * message while refusing some recipients; that is still a send, so the user
 * is told who missed it rather than invited to send it again.
 */
export const describeSendOutcome = (
  outcome: MailSendOutcome
): SendOutcomeNotice =>
  outcome.refusedRecipients.length === 0
    ? { message: "Message sent", tone: "success" }
    : {
        message: `Message sent, but the server refused ${outcome.refusedRecipients.join(", ")}`,
        tone: "warning",
      };
