import { open } from "node:fs/promises";

import { Effect, Schema } from "effect";
import { dialog } from "electron";

import type { DatabaseRecoveryKeyExportOutcome } from "../shared/ipc/settings";
import { decodeDatabaseKey, encodeDatabaseKey } from "./database-key";

const DatabaseRecoveryKeyFile = Schema.Struct({
  format: Schema.Literal("kisa-database-recovery-key"),
  key: Schema.String,
  version: Schema.Literal(1),
});
type DatabaseRecoveryKeyFile = typeof DatabaseRecoveryKeyFile.Type;

// oxlint-disable-next-line unicorn/throw-new-error
class DatabaseRecoveryKeyError extends Schema.TaggedError<DatabaseRecoveryKeyError>()(
  "DatabaseRecoveryKeyError",
  { message: Schema.String }
) {}

const exportError = (): DatabaseRecoveryKeyError =>
  new DatabaseRecoveryKeyError({
    message: "Could not export the database recovery key",
  });

const invalidRecoveryKey = (): DatabaseRecoveryKeyError =>
  new DatabaseRecoveryKeyError({
    message: "Database recovery key is invalid",
  });

export const encodeDatabaseRecoveryKeyFile = (key: Uint8Array): Uint8Array => {
  let encodedKey: string;
  try {
    encodedKey = encodeDatabaseKey(key);
  } catch {
    throw invalidRecoveryKey();
  }

  const recoveryKeyFile: DatabaseRecoveryKeyFile = {
    format: "kisa-database-recovery-key",
    key: encodedKey,
    version: 1,
  };
  return Buffer.from(`${JSON.stringify(recoveryKeyFile, null, 2)}\n`);
};

export const decodeDatabaseRecoveryKeyFile = (contents: string): Buffer => {
  try {
    const document = Schema.decodeUnknownSync(DatabaseRecoveryKeyFile)(
      JSON.parse(contents)
    );
    return decodeDatabaseKey(document.key);
  } catch {
    throw invalidRecoveryKey();
  }
};

const confirmRecoveryKeyExport = Effect.fn("confirmRecoveryKeyExport")(
  function* confirmRecoveryKeyExportEffect() {
    const result = yield* Effect.tryPromise({
      catch: exportError,
      try: () =>
        dialog.showMessageBox({
          buttons: ["Export Key", "Cancel"],
          cancelId: 1,
          defaultId: 1,
          detail:
            "Store it somewhere secure. Kisa will never ask you to share it.",
          message:
            "Anyone with this recovery key can read your local mail database.",
          noLink: true,
          title: "Export database recovery key?",
          type: "warning",
        }),
    });

    return result.response === 0;
  }
);

const chooseRecoveryKeyDestination = Effect.fn("chooseRecoveryKeyDestination")(
  function* chooseRecoveryKeyDestinationEffect(isDevelopment: boolean) {
    const result = yield* Effect.tryPromise({
      catch: exportError,
      try: () =>
        dialog.showSaveDialog({
          defaultPath: isDevelopment
            ? "Kisa Development Database Recovery Key.kisa-key"
            : "Kisa Database Recovery Key.kisa-key",
          filters: [{ extensions: ["kisa-key"], name: "Kisa recovery key" }],
          properties: ["createDirectory", "showOverwriteConfirmation"],
          title: "Export database recovery key",
        }),
    });

    return result.canceled ? undefined : result.filePath;
  }
);

const writeRecoveryKeyFile = Effect.fn("writeRecoveryKeyFile")(
  function* writeRecoveryKeyFileEffect(filePath: string, contents: Uint8Array) {
    yield* Effect.tryPromise({
      catch: exportError,
      try: async () => {
        const file = await open(filePath, "w", 0o600);
        try {
          await file.chmod(0o600);
          await file.writeFile(contents);
          await file.sync();
        } finally {
          await file.close();
        }
      },
    });
  }
);

export const exportDatabaseRecoveryKey = Effect.fn("exportDatabaseRecoveryKey")(
  function* exportDatabaseRecoveryKey(key: Uint8Array, isDevelopment: boolean) {
    if (!(yield* confirmRecoveryKeyExport())) {
      return "cancelled" satisfies DatabaseRecoveryKeyExportOutcome;
    }

    const destination = yield* chooseRecoveryKeyDestination(isDevelopment);

    if (destination === undefined || destination.length === 0) {
      return "cancelled" satisfies DatabaseRecoveryKeyExportOutcome;
    }

    const contents = yield* Effect.try({
      catch: exportError,
      try: () => encodeDatabaseRecoveryKeyFile(key),
    });

    yield* writeRecoveryKeyFile(destination, contents).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          contents.fill(0);
        })
      )
    );
    return "saved" satisfies DatabaseRecoveryKeyExportOutcome;
  }
);
