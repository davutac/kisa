import { Effect, Option, Redacted, Schema } from "effect";
import { safeStorage } from "electron";

import { CredentialStorageError } from "./credential-storage";

/**
 * The plaintext inside a password account's encrypted `credentials` blob.
 * The `kind` keeps it from ever being read as an OAuth grant, or one as it.
 */
const PasswordCredentials = Schema.fromJsonString(
  Schema.Struct({
    kind: Schema.Literal("password"),
    password: Schema.NonEmptyString,
  })
);
// Decoding to an option drops the parse issue, which would quote the input.
const decodePasswordCredentials =
  Schema.decodeUnknownOption(PasswordCredentials);

/** Seals an app password for `mail_accounts.credentials`. */
export const encryptPasswordCredentials = (
  password: Redacted.Redacted<string>
): Effect.Effect<Buffer, CredentialStorageError> =>
  Effect.tryPromise({
    catch: () =>
      new CredentialStorageError({
        message: "Secure credential storage failed",
      }),
    try: () =>
      safeStorage.encryptStringAsync(
        JSON.stringify({ kind: "password", password: Redacted.value(password) })
      ),
  });

/** Opens a sealed app password; it is redacted from the moment it is read. */
export const decryptPasswordCredentials = Effect.fn(
  "decryptPasswordCredentials"
)(function* decryptPasswordCredentials(credentials: Buffer) {
  const failure = new CredentialStorageError({
    message: "Could not read the saved password",
  });
  const { result } = yield* Effect.tryPromise({
    catch: () => failure,
    try: () => safeStorage.decryptStringAsync(credentials),
  });
  const decoded = decodePasswordCredentials(result);

  if (Option.isNone(decoded)) {
    return yield* failure;
  }

  return Redacted.make(decoded.value.password, { label: "app password" });
});
