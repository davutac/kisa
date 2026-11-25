import type { Effect } from "effect";
import { Context } from "effect";

import type {
  MailAuthError,
  MailConnectionError,
  MailProtocolError,
  MailSendRejectedError,
  MailSendUnknownError,
  MailThrottledError,
} from "./errors";
import type { AccountId } from "./ids";
import type { ImapAuth } from "./session";
import type { SmtpServer } from "./store";

export interface SmtpSendRequest {
  readonly accountId: AccountId;
  readonly auth: ImapAuth;
  /** Who the server delivers to, Bcc included; the message itself has no Bcc. */
  readonly envelope: {
    readonly from: string;
    readonly to: readonly string[];
  };
  readonly message: Uint8Array;
  readonly server: SmtpServer;
}

export interface SmtpSendResult {
  /** Recipients the server refused while it accepted the message for others. */
  readonly refused: readonly string[];
}

/**
 * Before the message is handed over, a failure means it was not sent:
 * `MailConnectionError` and `MailThrottledError` are worth retrying,
 * `MailSendRejectedError` and `MailProtocolError` are not. Only
 * `MailSendUnknownError` leaves the outcome open.
 */
export type MailSendError =
  | MailAuthError
  | MailConnectionError
  | MailProtocolError
  | MailSendRejectedError
  | MailSendUnknownError
  | MailThrottledError;

export class SmtpTransport extends Context.Service<
  SmtpTransport,
  {
    readonly send: (
      request: SmtpSendRequest
    ) => Effect.Effect<SmtpSendResult, MailSendError>;
  }
>()("@repo/mail/SmtpTransport") {}
