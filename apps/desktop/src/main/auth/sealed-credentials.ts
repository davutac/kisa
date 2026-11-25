import { Effect, Option, Redacted, Schema } from "effect";
import { safeStorage } from "electron";

import { CredentialStorageError } from "./credential-storage";

/**
 * The plaintext inside an account's encrypted `credentials` blob: an app
 * password, or a Microsoft account's refresh token. The `kind` keeps one from
 * ever being read as the other, and any other sealed blob from being read as
 * either. An access token is never stored: it is renewed from the refresh
 * token and kept in memory only.
 */
const SealedCredentials = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("password"),
      password: Schema.NonEmptyString,
    }),
    Schema.Struct({
      kind: Schema.Literal("microsoft-oauth"),
      refreshToken: Schema.NonEmptyString,
    }),
  ])
);
// Decoding to an option drops the parse issue, which would quote the input.
const decodeSealedCredentials = Schema.decodeUnknownOption(SealedCredentials);

export type OpenedCredentials =
  | {
      readonly kind: "microsoft-oauth";
      readonly refreshToken: Redacted.Redacted<string>;
    }
  | {
      readonly kind: "password";
      readonly password: Redacted.Redacted<string>;
    };

const seal = (
  credentials: typeof SealedCredentials.Type
): Effect.Effect<Buffer, CredentialStorageError> =>
  Effect.tryPromise({
    catch: () =>
      new CredentialStorageError({
        message: "Secure credential storage failed",
      }),
    try: () => safeStorage.encryptStringAsync(JSON.stringify(credentials)),
  });

/** Seals an app password for `mail_accounts.credentials`. */
export const sealPassword = (
  password: Redacted.Redacted<string>
): Effect.Effect<Buffer, CredentialStorageError> =>
  seal({ kind: "password", password: Redacted.value(password) });

/** Seals a Microsoft refresh token for `mail_accounts.credentials`. */
export const sealMicrosoftRefreshToken = (
  refreshToken: Redacted.Redacted<string>
): Effect.Effect<Buffer, CredentialStorageError> =>
  seal({ kind: "microsoft-oauth", refreshToken: Redacted.value(refreshToken) });

/** Opens a sealed sign-in; its secret is redacted from the moment it is read. */
export const openSealedCredentials = Effect.fn("openSealedCredentials")(
  function* openSealedCredentials(credentials: Buffer) {
    const failure = new CredentialStorageError({
      message: "Could not read the saved sign-in",
    });
    const { result } = yield* Effect.tryPromise({
      catch: () => failure,
      try: () => safeStorage.decryptStringAsync(credentials),
    });
    const decoded = decodeSealedCredentials(result);

    if (Option.isNone(decoded)) {
      return yield* failure;
    }

    return decoded.value.kind === "password"
      ? ({
          kind: "password",
          password: Redacted.make(decoded.value.password, {
            label: "app password",
          }),
        } satisfies OpenedCredentials)
      : ({
          kind: "microsoft-oauth",
          refreshToken: Redacted.make(decoded.value.refreshToken, {
            label: "Microsoft refresh token",
          }),
        } satisfies OpenedCredentials);
  }
);
