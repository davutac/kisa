import { MailAuthError } from "@repo/mail/errors";
import { ImapConnector } from "@repo/mail/session";
import { SmtpTransport } from "@repo/mail/smtp";
import { Effect, Layer } from "effect";

import type { DemoMailServer } from "./demo-mail-server";
import { createDemoMailServers } from "./demo-mailbox";

// What the engine is given in place of IMAP and SMTP in demo mode. Neither
// layer opens a socket, and neither reads the sign-in it is handed.

let servers: ReadonlyMap<string, DemoMailServer> | undefined;

/** Built on first use, so the sample mail is dated from this launch. */
const demoMailServers = (): ReadonlyMap<string, DemoMailServer> => {
  servers ??= createDemoMailServers(Date.now());

  return servers;
};

export const DemoImapConnectorLive = Layer.succeed(
  ImapConnector,
  ImapConnector.of({
    connect: (request) =>
      Effect.suspend(() => {
        const server = demoMailServers().get(request.accountId);

        return server === undefined
          ? Effect.fail(
              new MailAuthError({
                accountId: request.accountId,
                message: "Demo mode has no such account",
              })
            )
          : Effect.succeed(server.session());
      }),
  })
);

/**
 * Accepts every message and delivers none. The account's server is handed
 * the message, since a provider that files sent mail itself (Gmail, Outlook)
 * files what its SMTP server accepted; for the others the engine appends the
 * Sent copy over IMAP.
 */
export const DemoSmtpTransportLive = Layer.succeed(
  SmtpTransport,
  SmtpTransport.of({
    send: (request) =>
      Effect.sync(() => {
        demoMailServers().get(request.accountId)?.acceptSent(request.message);

        return { refused: [] };
      }),
  })
);
