import { MailAuthError, MailConnectionError } from "@repo/mail/errors";
import type { ImapAuth } from "@repo/mail/session";
import type { MailAccount } from "@repo/mail/store";
import { Effect } from "effect";

import { requireSecureCredentialStorage } from "../../auth/credential-storage";
import {
  forgetMicrosoftAccessToken,
  getMicrosoftAccessToken,
} from "../../auth/microsoft-access-tokens";
import { openSealedCredentials } from "../../auth/sealed-credentials";
import { withDatabaseClient } from "../../database";

/**
 * The sign-in an IMAP or SMTP connection uses, decrypted only here for the
 * connection about to sign in: the account's app password, or for a Microsoft
 * account an access token renewed from its refresh token when it runs low.
 * Either stays redacted throughout and never leaves main. A blob that is not
 * a sealed sign-in fails closed instead of reaching a server.
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

    const credentials = yield* openSealedCredentials(row.credentials).pipe(
      Effect.mapError(
        () =>
          new MailAuthError({
            accountId: account.accountId,
            message:
              "Could not read the saved sign-in. Sign in to the account again.",
          })
      )
    );

    if (credentials.kind === "password") {
      return {
        kind: "password",
        password: credentials.password,
        user: account.username,
      } satisfies ImapAuth;
    }

    // Microsoft being busy or unreachable refused nothing: the connection is
    // tried again later. Only a refusal asks the user to sign in again.
    const token = yield* getMicrosoftAccessToken(
      account.accountId,
      credentials.refreshToken
    ).pipe(
      Effect.mapError((error) =>
        error.kind === "unavailable"
          ? new MailConnectionError({
              accountId: account.accountId,
              message: "Could not reach Microsoft to renew the sign-in",
            })
          : new MailAuthError({
              accountId: account.accountId,
              message:
                error.kind === "local"
                  ? "This build of Kisa can't sign in to Microsoft accounts"
                  : "Sign in to Microsoft again to keep receiving mail",
            })
      )
    );

    return {
      accessToken: token.accessToken,
      expiresAt: token.expiresAt,
      kind: "oauth",
      user: account.username,
    } satisfies ImapAuth;
  }
);

/**
 * Forgets what is kept in memory for an account's sign-in. A server that
 * refuses a sign-in calls this, so the next connection renews the token
 * instead of offering the refused one again, and so does removing the
 * account. A password account keeps nothing here.
 */
export const forgetAccountSignIn = (accountId: string): void => {
  forgetMicrosoftAccessToken(accountId);
};
