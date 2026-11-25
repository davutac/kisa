import { Effect } from "effect";
import type { Redacted } from "effect";

import { CredentialStorageError } from "./credential-storage";
import { openSealedCredentials } from "./sealed-credentials";

/** Seals an app password for `mail_accounts.credentials`. */
export { sealPassword as encryptPasswordCredentials } from "./sealed-credentials";

/**
 * Opens a sealed app password; it is redacted from the moment it is read. A
 * blob that holds any other sign-in fails, so it is never sent as a password.
 */
export const decryptPasswordCredentials = Effect.fn(
  "decryptPasswordCredentials"
)(function* decryptPasswordCredentials(credentials: Buffer) {
  const failure = new CredentialStorageError({
    message: "Could not read the saved password",
  });
  const opened = yield* openSealedCredentials(credentials).pipe(
    Effect.mapError(() => failure)
  );

  if (opened.kind !== "password") {
    return yield* failure;
  }

  return opened.password satisfies Redacted.Redacted<string>;
});
