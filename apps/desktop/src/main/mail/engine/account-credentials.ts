import { MailAuthError, MailConnectionError } from "@repo/mail/errors";
import type { ImapAuth } from "@repo/mail/session";
import type { MailAccount } from "@repo/mail/store";
import { Effect } from "effect";

import { requireSecureCredentialStorage } from "../../auth/credential-storage";
import { decryptPasswordCredentials } from "../../auth/password-credentials";
import { withDatabaseClient } from "../../database";

/**
 * The sign-in an IMAP or SMTP connection uses: the account's saved app
 * password, decrypted only here for the connection about to sign in. It
 * stays redacted throughout and never leaves main. A blob that is not a
 * sealed password fails closed instead of reaching a server.
 */
export const resolveImapAuth = Effect.fn("resolveImapAuth")(
  function* resolveImapAuth(account: MailAccount) {
    yield* requireSecureCredentialStorage.pipe(
      Effect.mapError(
        () =>
          new MailConnectionError({
            accountId: account.accountId,
            message: "Secure credential storage is unavailable",
          })
      )
    );
    const row = yield* withDatabaseClient((database) =>
      database.query.mailAccounts.findFirst({
        columns: { credentials: true },
        where: { accountId: account.accountId },
      })
    ).pipe(
      Effect.mapError(
        () =>
          new MailConnectionError({
            accountId: account.accountId,
            message: "Could not load the account's sign-in",
          })
      )
    );

    if (row === undefined) {
      return yield* new MailAuthError({
        accountId: account.accountId,
        message: "This account is not connected",
      });
    }

    const password = yield* decryptPasswordCredentials(row.credentials).pipe(
      Effect.mapError(
        () =>
          new MailAuthError({
            accountId: account.accountId,
            message:
              "Could not read the saved password. Remove the account and add it again.",
          })
      )
    );

    return { password, user: account.username } satisfies ImapAuth;
  }
);
