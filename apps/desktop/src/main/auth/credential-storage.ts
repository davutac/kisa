import { Effect, Schema } from "effect";
import { safeStorage } from "electron";

import {
  getLinuxSecretStorageErrorMessage,
  isSecureLinuxStorageBackend,
} from "../app/linux-secret-storage";

// oxlint-disable-next-line unicorn/throw-new-error
export class CredentialStorageError extends Schema.TaggedError<CredentialStorageError>()(
  "CredentialStorageError",
  { message: Schema.String }
) {}

/**
 * Every saved sign-in is sealed with `safeStorage`. On Linux only a real
 * secret store counts: `basic_text` would leave credentials readable on disk.
 */
export const requireSecureCredentialStorage: Effect.Effect<
  void,
  CredentialStorageError
> = Effect.tryPromise({
  catch: () => new CredentialStorageError({ message: "unavailable" }),
  try: async () => {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error("encryption unavailable");
    }

    if (
      process.platform === "linux" &&
      !isSecureLinuxStorageBackend(safeStorage.getSelectedStorageBackend())
    ) {
      throw new Error("insecure storage backend");
    }
  },
}).pipe(
  Effect.mapError(
    () =>
      new CredentialStorageError({
        message:
          process.platform === "linux"
            ? getLinuxSecretStorageErrorMessage(
                process.env["XDG_CURRENT_DESKTOP"]
              )
            : "Secure credential storage is unavailable on this device",
      })
  )
);
