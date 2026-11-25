import { mailAccounts } from "@repo/database/schemas";
import { eq } from "drizzle-orm";
import { Effect, Redacted, Semaphore } from "effect";

import { withDatabaseClient } from "../database";
import { getMicrosoftOAuthEnvironment } from "./microsoft-client";
import {
  MicrosoftSignInError,
  refreshMicrosoftTokens,
} from "./microsoft-oauth";
import type { MicrosoftTokens } from "./microsoft-oauth";
import { sealMicrosoftRefreshToken } from "./sealed-credentials";

/**
 * A Microsoft account's access token is never stored: it lives here, in
 * memory, and is renewed from the sealed refresh token when it runs low.
 */
export interface MicrosoftAccessToken {
  readonly accessToken: Redacted.Redacted<string>;
  readonly expiresAt: number;
}

/**
 * A connection opened with a token about to expire is closed again almost at
 * once, so a token with less than this left is renewed first.
 */
const MIN_REMAINING_MS = 5 * 60_000;

const accessTokens = new Map<string, MicrosoftAccessToken>();
const renewals = new Map<string, Semaphore.Semaphore>();

const usable = (accountId: string): MicrosoftAccessToken | undefined => {
  const token = accessTokens.get(accountId);

  return token !== undefined && token.expiresAt - Date.now() > MIN_REMAINING_MS
    ? token
    : undefined;
};

/** Keeps the access token a sign-in or renewal just produced. */
export const rememberMicrosoftAccessToken = (
  accountId: string,
  tokens: MicrosoftTokens
): void => {
  accessTokens.set(accountId, {
    accessToken: tokens.accessToken,
    expiresAt: tokens.expiresAt,
  });
};

/**
 * Drops the account's access token: when the account is removed, and when a
 * server refuses the token, so the next connection renews it instead.
 */
export const forgetMicrosoftAccessToken = (accountId: string): void => {
  accessTokens.delete(accountId);
};

/**
 * Stores the refresh token Microsoft issued with a renewal, which replaces
 * the one used. An update only: an account removed meanwhile must not come
 * back. A failure leaves the old token in place, which Microsoft still
 * accepts, so it is not an error for the connection being opened.
 */
const storeRefreshToken = (
  accountId: string,
  refreshToken: Redacted.Redacted<string>
): Effect.Effect<void> =>
  sealMicrosoftRefreshToken(refreshToken).pipe(
    Effect.flatMap((credentials) =>
      withDatabaseClient((database) =>
        database
          .update(mailAccounts)
          .set({ credentials, updatedAt: Date.now() })
          .where(eq(mailAccounts.accountId, accountId))
          .run()
      )
    ),
    Effect.catch(() =>
      Effect.logWarning("Could not store a renewed Microsoft sign-in")
    ),
    Effect.asVoid
  );

/**
 * An access token for the account: the one in memory, or one renewed with
 * `refreshToken`. An account renews one at a time, so two connections opened
 * together make one request and share its token.
 */
export const getMicrosoftAccessToken = Effect.fn("getMicrosoftAccessToken")(
  function* getMicrosoftAccessToken(
    accountId: string,
    refreshToken: Redacted.Redacted<string>
  ): Effect.fn.Return<MicrosoftAccessToken, MicrosoftSignInError> {
    let renewal = renewals.get(accountId);

    if (renewal === undefined) {
      renewal = Semaphore.makeUnsafe(1);
      renewals.set(accountId, renewal);
    }

    return yield* renewal.withPermit(
      Effect.gen(function* renew() {
        // Another connection may have renewed while this one waited.
        const current = usable(accountId);

        if (current !== undefined) {
          return current;
        }

        const environment = getMicrosoftOAuthEnvironment();

        if (environment === undefined) {
          return yield* new MicrosoftSignInError({ kind: "local" });
        }

        const tokens = yield* refreshMicrosoftTokens(environment, refreshToken);
        rememberMicrosoftAccessToken(accountId, tokens);

        if (
          tokens.refreshToken !== undefined &&
          Redacted.value(tokens.refreshToken) !== Redacted.value(refreshToken)
        ) {
          yield* storeRefreshToken(accountId, tokens.refreshToken);
        }

        return {
          accessToken: tokens.accessToken,
          expiresAt: tokens.expiresAt,
        } satisfies MicrosoftAccessToken;
      })
    );
  }
);
