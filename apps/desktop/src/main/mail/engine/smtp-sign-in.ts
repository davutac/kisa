import type { MailSendError } from "@repo/mail/smtp";
import type { SmtpServer } from "@repo/mail/store";
import { Context, Layer } from "effect";
import type { Effect } from "effect";

import { smtpOptions, verifyOverSmtp } from "./smtp-transport";
import type { SmtpSignInRequest } from "./smtp-transport";

/**
 * Checks that an outgoing server accepts an account's sign-in, without
 * sending. Adding an account uses it; tests point it at a loopback server.
 */
export class SmtpSignIn extends Context.Service<
  SmtpSignIn,
  {
    readonly verify: (
      request: SmtpSignInRequest & { readonly server: SmtpServer }
    ) => Effect.Effect<void, MailSendError>;
  }
>()("kisa/main/mail/engine/SmtpSignIn") {}

export const SmtpSignInLive = Layer.succeed(
  SmtpSignIn,
  SmtpSignIn.of({
    verify: (request) => verifyOverSmtp(smtpOptions(request.server), request),
  })
);
