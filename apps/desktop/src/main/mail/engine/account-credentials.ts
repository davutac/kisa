import { MailAuthError, MailConnectionError } from "@repo/mail/errors";
import type { ImapAuth } from "@repo/mail/session";
import type { MailAccount } from "@repo/mail/store";
import { Effect, Redacted } from "effect";

import { getGoogleAccessGrant } from "../../auth/auth";
import { requireSecureCredentialStorage } from "../../auth/credential-storage";
import { decryptPasswordCredentials } from "../../auth/password-credentials";
import { withDatabaseClient } from "../../database";

/**
 * An app password account's saved password. It is decrypted only here, for
 * the connection about to sign in, and stays redacted throughout.
 */
const resolvePasswordAuth = Effect.fn("resolvePasswordAuth")(
  function* resolvePasswordAuth(account: MailAccount) {
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
        columns: { authKind: true, credentials: true },
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

    if (row?.authKind !== "password") {
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

    return {
      kind: "password",
      password,
      user: account.username,
    } satisfies ImapAuth;
  }
);

/**
 * The sign-in an IMAP or SMTP connection uses. A Google token is refreshed
 * here when it is about to expire; an app password is decrypted. Either stays
 * in main and goes only to the connection that authenticates with it.
 */
export const resolveImapAuth = Effect.fn("resolveImapAuth")(
  function* resolveImapAuth(account: MailAccount) {
    if (account.authKind === "password") {
      return yield* resolvePasswordAuth(account);
    }

    const grant = yield* getGoogleAccessGrant(account.accountId).pipe(
      Effect.mapError((error) =>
        error.reauthorize === true
          ? new MailAuthError({
              accountId: account.accountId,
              message: "Sign in to Google again to keep receiving mail",
            })
          : new MailConnectionError({
              accountId: account.accountId,
              message: "Could not renew the Google sign-in",
            })
      )
    );

    return {
      accessToken: Redacted.make(grant.accessToken, {
        label: "Google access token",
      }),
      expiresAt: grant.expiresAt,
      kind: "oauth",
      user: account.username,
    } satisfies ImapAuth;
  }
);
