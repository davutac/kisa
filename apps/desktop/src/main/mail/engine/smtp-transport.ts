import { Readable } from "node:stream";

import {
  MailAuthError,
  MailConnectionError,
  MailProtocolError,
  MailSendRejectedError,
  MailSendUnknownError,
  MailThrottledError,
} from "@repo/mail/errors";
import type { AccountId } from "@repo/mail/ids";
import type { ImapAuth } from "@repo/mail/session";
import { SmtpTransport } from "@repo/mail/smtp";
import type {
  MailSendError,
  SmtpSendRequest,
  SmtpSendResult,
} from "@repo/mail/smtp";
import type { SmtpServer } from "@repo/mail/store";
import { Effect, Layer, Option, Redacted, Schema } from "effect";
import SMTPConnection from "nodemailer/lib/smtp-connection";
import type {
  AuthenticationType,
  Options as SmtpOptions,
} from "nodemailer/lib/smtp-connection";
import XOAuth2 from "nodemailer/lib/xoauth2";

/**
 * The message as a stream that records when the connection starts reading
 * it. nodemailer reads it only once the server has accepted `DATA`, so from
 * then on a lost connection leaves the outcome unknown.
 */
class HandOverStream extends Readable {
  handedOver = false;
  private readonly message: Buffer;

  constructor(message: Uint8Array) {
    super();
    this.message = Buffer.from(message);
  }

  override _read(): void {
    if (!this.handedOver) {
      this.handedOver = true;
      this.push(this.message);
      this.push(null);
    }
  }
}

/** What nodemailer reports about a failure. */
interface SmtpFailure {
  readonly code?: string | undefined;
  readonly command?: string | undefined;
  readonly responseCode?: number | undefined;
}

const AUTH_CODES: ReadonlySet<string> = new Set([
  "EAUTH",
  "ENOAUTH",
  "EOAUTH2",
]);
const LOCAL_REFUSALS: ReadonlySet<string> = new Set(["EENVELOPE", "EMESSAGE"]);

/**
 * Sorts a failure by what it says about the message. A server reply decides
 * it: 5xx refused it, 4xx asked to try later. Without a reply, a failure
 * before the hand-over means nothing was sent, and one after it means the
 * message may have been delivered.
 */
export const toSendError = (
  accountId: AccountId,
  failure: SmtpFailure,
  handedOver: boolean
): MailSendError => {
  if (failure.code !== undefined && AUTH_CODES.has(failure.code)) {
    return new MailAuthError({
      accountId,
      message: "The mail server refused the account's sign-in",
    });
  }
  if (failure.responseCode !== undefined && failure.responseCode >= 500) {
    return new MailSendRejectedError({
      accountId,
      message:
        failure.command === "RCPT TO"
          ? "The mail server refused every recipient"
          : "The mail server refused this message",
    });
  }
  if (failure.responseCode !== undefined && failure.responseCode >= 400) {
    return new MailThrottledError({
      accountId,
      message: "The mail server can't take the message right now",
    });
  }
  if (handedOver) {
    return new MailSendUnknownError({
      accountId,
      message:
        "The connection dropped while sending, so the message may have been delivered. Check Sent before sending it again.",
    });
  }
  if (failure.code !== undefined && LOCAL_REFUSALS.has(failure.code)) {
    return new MailProtocolError({
      accountId,
      message: "This message can't be sent as written",
    });
  }
  return new MailConnectionError({
    accountId,
    message: "Could not reach the mail server",
  });
};

/** The fields of a nodemailer error, read once where it arrives. */
const SmtpFailureFields = Schema.Struct({
  code: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
  responseCode: Schema.optional(Schema.Number),
});
const decodeFailure = Schema.decodeUnknownOption(SmtpFailureFields);

const toFailure = <Failure>(error: Failure): SmtpFailure =>
  Option.getOrElse(decodeFailure(error), () => ({}));

const toLogin = (auth: ImapAuth): AuthenticationType =>
  auth.kind === "oauth"
    ? {
        oauth2: new XOAuth2({
          accessToken: Redacted.value(auth.accessToken),
          user: auth.user,
        }),
        user: auth.user,
      }
    : { pass: Redacted.value(auth.password), user: auth.user };

/** Connection settings for an account's outgoing server. */
export const smtpOptions = (server: SmtpServer): SmtpOptions => ({
  connectionTimeout: 30_000,
  debug: false,
  greetingTimeout: 30_000,
  host: server.host,
  logger: false,
  // EHLO names the client; an address literal keeps the computer's name out.
  name: "[127.0.0.1]",
  port: server.port,
  requireTLS: server.security === "starttls",
  secure: server.security === "tls",
  socketTimeout: 120_000,
  tls: { minVersion: "TLSv1.2", servername: server.host },
  transactionLog: false,
});

/**
 * One message over one connection: connect, sign in, send, quit. Runs
 * uninterruptibly, bounded by the socket timeouts, because cutting it off
 * after the hand-over would leave the outcome unknown for no reason.
 */
export const sendOverSmtp = (
  options: SmtpOptions,
  request: SmtpSendRequest
): Effect.Effect<SmtpSendResult, MailSendError> =>
  Effect.uninterruptible(
    Effect.callback<SmtpSendResult, MailSendError>((resume) => {
      const connection = new SMTPConnection(options);
      const message = new HandOverStream(request.message);
      let settled = false;

      const fail = <Failure>(error: Failure): void => {
        if (settled) {
          return;
        }
        settled = true;
        connection.close();
        resume(
          Effect.fail(
            toSendError(request.accountId, toFailure(error), message.handedOver)
          )
        );
      };

      connection.on("error", fail);
      connection.on("end", () => {
        fail({ code: "ECONNECTION" });
      });
      connection.connect((connectError) => {
        if (connectError !== undefined) {
          fail(connectError);
          return;
        }
        connection.login(toLogin(request.auth), (loginError) => {
          if (loginError !== null) {
            fail(loginError);
            return;
          }
          connection.send(
            { from: request.envelope.from, to: [...request.envelope.to] },
            message,
            (sendError, info) => {
              if (sendError !== null) {
                fail(sendError);
                return;
              }
              settled = true;
              connection.quit();
              resume(Effect.succeed({ refused: info?.rejected ?? [] }));
            }
          );
        });
      });
    })
  );

export const SmtpTransportLive = Layer.succeed(
  SmtpTransport,
  SmtpTransport.of({
    send: (request) => sendOverSmtp(smtpOptions(request.server), request),
  })
);

export interface SmtpSignInRequest {
  readonly accountId: AccountId;
  readonly auth: ImapAuth;
}

/**
 * Connects, signs in and quits without sending, to check an account's
 * outgoing server before the account is saved. Nothing can be lost by
 * stopping it, so unlike a send it is interruptible and closes the
 * connection when interrupted.
 */
export const verifyOverSmtp = (
  options: SmtpOptions,
  request: SmtpSignInRequest
): Effect.Effect<void, MailSendError> =>
  Effect.callback(
    (resume: (signedIn: Effect.Effect<void, MailSendError>) => void) => {
      const connection = new SMTPConnection(options);
      let settled = false;

      const fail = <Failure>(error: Failure): void => {
        if (settled) {
          return;
        }
        settled = true;
        connection.close();
        resume(
          Effect.fail(toSendError(request.accountId, toFailure(error), false))
        );
      };

      connection.on("error", fail);
      connection.on("end", () => {
        fail({ code: "ECONNECTION" });
      });
      connection.connect((connectError) => {
        if (connectError !== undefined) {
          fail(connectError);
          return;
        }
        connection.login(toLogin(request.auth), (loginError) => {
          if (loginError !== null) {
            fail(loginError);
            return;
          }
          settled = true;
          connection.quit();
          resume(Effect.void);
        });
      });

      return Effect.sync(() => {
        if (!settled) {
          settled = true;
          connection.close();
        }
      });
    }
  );
