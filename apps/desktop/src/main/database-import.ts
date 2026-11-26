import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { Effect, Exit, Schema, Scope } from "effect";
import { app, dialog } from "electron";

import type {
  DatabaseImportFileKind,
  DatabaseImportFileSelection,
  DatabaseImportOutcome,
  DatabaseImportProgress,
  DatabaseImportSession,
  DatabaseImportStatus,
} from "../shared/ipc/settings";
import type { DatabaseKeyEncryptor } from "./database-key";
import { sealDatabaseKey } from "./database-key";
import { getDatabaseKeyPath } from "./database-path";
import { decodeDatabaseRecoveryKeyFile } from "./database-recovery-key";
import { DEMO_MODE_REFUSAL, isDemoMode } from "./demo/demo-mode";

/**
 * How far activation has got, recorded in the manifest so a start that finds
 * it knows what the files on disk are:
 * - `pending`: nothing is swapped. The current database and key are whole.
 * - `swapping`: the backup is complete and the swap has begun, so the active
 *   database and key may no longer be a pair. The backup is never made again.
 * - `restoring`: the swap failed and the backup is being moved back.
 *
 * A manifest written before steps were recorded has none. Nothing is known
 * about how far it got, so it is never dropped or restored on that account.
 */
const DatabaseImportStep = Schema.Literals([
  "pending",
  "restoring",
  "swapping",
]);

const DatabaseImportManifest = Schema.Struct({
  backupDirectory: Schema.String,
  databaseFile: Schema.String,
  format: Schema.Literal("kisa-database-import"),
  keyFile: Schema.String,
  step: Schema.optional(DatabaseImportStep),
  version: Schema.Literal(1),
});

type DatabaseImportManifest = typeof DatabaseImportManifest.Type;

/**
 * What activation did at this start. `dropped` and `restored` both mean the
 * app runs on the database it had before: the first without anything having
 * been swapped, the second after the backup was moved back.
 */
export type DatabaseImportActivation =
  | "activated"
  | "dropped"
  | "none"
  | "restored";

interface DatabaseImportOptions {
  readonly activeDatabasePath: string;
  readonly isDevelopment: boolean;
  readonly keyEncryptor: DatabaseKeyEncryptor;
  readonly onProgress: (progress: DatabaseImportProgress) => void;
  readonly sessionId: string;
  readonly validate: (databasePath: string, key: Uint8Array) => Promise<void>;
}

interface DatabaseImportSelectionSession {
  readonly databasePath?: string;
  readonly recoveryKeyPath?: string;
  readonly sessionId: string;
  readonly state: "selecting";
}

/**
 * What this process is doing about an import. Whether an import is waiting
 * for a restart is not kept here: the manifest file is that fact, so it is
 * read from disk whenever it is asked for and cannot go stale.
 */
interface DatabaseImportRun {
  /** Resolves once the import has ended and cleaned up after itself. */
  readonly ended: Promise<null>;
  readonly state: "importing";
  /**
   * Owns the import's abort signal. Quit stops the import by closing it; the
   * import closes it too when it ends, which is harmless after a stop.
   */
  readonly stop: Scope.Closeable;
}

type DatabaseImportState =
  | DatabaseImportSelectionSession
  | DatabaseImportRun
  | undefined;

let databaseImportState: DatabaseImportState;

// oxlint-disable-next-line unicorn/throw-new-error
class DatabaseImportError extends Schema.TaggedError<
  DatabaseImportError,
  { readonly brand: unique symbol }
>()("DatabaseImportError", { message: Schema.String }) {}

const importError = (): DatabaseImportError =>
  new DatabaseImportError({ message: "Could not import the database" });

const statusError = (): DatabaseImportError =>
  new DatabaseImportError({
    message: "Could not check for a waiting database import",
  });

const discardError = (): DatabaseImportError =>
  new DatabaseImportError({ message: "Could not discard the import" });

const restartError = (): DatabaseImportError =>
  new DatabaseImportError({
    message: "Could not restart to finish the import",
  });

const VALIDATION_FAILED_MESSAGE =
  "This database could not be opened with its recovery key. Databases from Kisa versions before the IMAP mail engine can't be imported.";

const getImportManifestPath = (databasePath: string): string =>
  `${databasePath}.pending-import.json`;

const isMissingFileError = <ErrorInput>(error: ErrorInput): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const readManifest = async (
  databasePath: string
): Promise<DatabaseImportManifest | undefined> => {
  let contents: string;

  try {
    contents = await readFile(getImportManifestPath(databasePath), "utf-8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }

  let manifest: DatabaseImportManifest;

  try {
    manifest = Schema.decodeUnknownSync(DatabaseImportManifest)(
      JSON.parse(contents)
    );
  } catch {
    throw importError();
  }

  // The staged files and the backup folder are named from one import id.
  // Activation deletes that folder on a drop and moves files out of it on a
  // restore, so a manifest naming another import's backup is refused.
  const databasePrefix = `${path.basename(databasePath)}.import-`;
  const importId = manifest.databaseFile.slice(databasePrefix.length);

  if (
    path.basename(manifest.databaseFile) !== manifest.databaseFile ||
    !manifest.databaseFile.startsWith(databasePrefix) ||
    importId.length === 0 ||
    manifest.keyFile !== `${manifest.databaseFile}.key` ||
    manifest.backupDirectory !== `before-import-${importId}`
  ) {
    throw importError();
  }

  return manifest;
};

const syncFile = async (filePath: string): Promise<void> => {
  const file = await open(filePath, "r+");

  try {
    await file.sync();
  } finally {
    await file.close();
  }
};

const copyFileIfPresent = async (
  source: string,
  destination: string
): Promise<void> => {
  try {
    await copyFile(source, destination);
    await chmod(destination, 0o600);
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }

    throw error;
  }
};

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await stat(filePath);

    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }

    throw error;
  }
};

/**
 * Copies one file into the backup. A backup file that exists is complete and
 * is never written again: once the swap has run, the active file is the
 * imported one, and overwriting would destroy the only copy of the original.
 * So the copy is made under another name and takes the real one only when it
 * is whole; a copy cut short by a crash is left under that other name and
 * simply made again.
 */
const backUpFile = async (
  source: string,
  destination: string
): Promise<void> => {
  if (await pathExists(destination)) {
    return;
  }

  const partial = `${destination}.partial`;

  try {
    await copyFile(source, partial);
  } catch (error) {
    await rm(partial, { force: true });

    if (isMissingFileError(error)) {
      return;
    }

    throw error;
  }

  await chmod(partial, 0o600);
  await syncFile(partial);
  await rename(partial, destination);
};

const removeDatabaseFiles = async (databasePath: string): Promise<void> => {
  await Promise.all([
    rm(databasePath, { force: true }),
    rm(`${databasePath}-shm`, { force: true }),
    rm(`${databasePath}-wal`, { force: true }),
  ]);
};

/**
 * The manifest goes first: one left pointing at files already removed would
 * fail every later start. A manifest that cannot be read names nothing that
 * can be trusted, so only the manifest itself is removed.
 */
const discardPendingImport = async (databasePath: string): Promise<void> => {
  let manifest: DatabaseImportManifest | undefined;

  try {
    manifest = await readManifest(databasePath);
  } catch {
    manifest = undefined;
  }

  // Only startup may end an activation that has begun to swap.
  if (manifest?.step === "swapping" || manifest?.step === "restoring") {
    throw importError();
  }

  await rm(getImportManifestPath(databasePath), { force: true });

  if (manifest === undefined) {
    return;
  }

  const directory = path.dirname(databasePath);
  await removeDatabaseFiles(path.join(directory, manifest.databaseFile));
  await rm(path.join(directory, manifest.keyFile), { force: true });
};

const hasPendingImport = (databasePath: string): Promise<boolean> =>
  pathExists(getImportManifestPath(databasePath));

const STAGED_FILE_SUFFIX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-wal|-shm|\.key)?$/u;

/**
 * Removes staged copies left by an import that never finished: a crash or a
 * quit before its manifest was written. Only called when this database has
 * no manifest, so nothing it removes is waiting to be activated. It matches
 * this database's own staged names exactly, because other databases live in
 * the same folder, and it never fails the start it runs in.
 */
const sweepStagedImports = async (databasePath: string): Promise<void> => {
  // A running import's copy has no manifest yet either.
  if (databaseImportState?.state === "importing") {
    return;
  }

  try {
    const directory = path.dirname(databasePath);
    const prefix = `${path.basename(databasePath)}.import-`;
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() &&
            entry.name.startsWith(prefix) &&
            STAGED_FILE_SUFFIX.test(entry.name.slice(prefix.length))
        )
        .map((entry) => rm(path.join(directory, entry.name), { force: true }))
    );
  } catch {
    // Leftovers cost disk space only; the next start tries again.
  }
};

/** Development cannot relaunch: `electron-vite` owns the renderer server. */
const restartOrQuit = (isDevelopment: boolean): void => {
  if (!isDevelopment) {
    app.relaunch();
  }

  app.quit();
};

export const getDatabaseImportStatus = Effect.fn("getDatabaseImportStatus")(
  function* getDatabaseImportStatusEffect(options: {
    readonly activeDatabasePath: string;
    readonly isDevelopment: boolean;
  }) {
    const restart = options.isDevelopment ? "quit" : "relaunch";

    if (databaseImportState?.state === "importing") {
      return { restart, state: "importing" } satisfies DatabaseImportStatus;
    }

    const isPending = yield* Effect.tryPromise({
      catch: statusError,
      try: () => hasPendingImport(options.activeDatabasePath),
    });

    return {
      restart,
      state: isPending ? "restart-pending" : "none",
    } satisfies DatabaseImportStatus;
  }
);

/**
 * Drops an import that is waiting for a restart, so the next start keeps the
 * current database. Refused while an import is running: that import writes
 * the same manifest, which a discard could otherwise remove under it.
 */
export const discardPendingDatabaseImport = Effect.fn(
  "discardPendingDatabaseImport"
)(function* discardPendingDatabaseImportEffect(activeDatabasePath: string) {
  if (databaseImportState?.state === "importing") {
    return yield* discardError();
  }

  yield* Effect.tryPromise({
    catch: discardError,
    try: () => discardPendingImport(activeDatabasePath),
  });
});

/** Restarts to activate a waiting import; does nothing without one. */
export const restartForPendingDatabaseImport = Effect.fn(
  "restartForPendingDatabaseImport"
)(function* restartForPendingDatabaseImportEffect(options: {
  readonly activeDatabasePath: string;
  readonly isDevelopment: boolean;
}) {
  const isPending = yield* Effect.tryPromise({
    catch: restartError,
    try: () => hasPendingImport(options.activeDatabasePath),
  });

  if (databaseImportState?.state === "importing" || !isPending) {
    return yield* restartError();
  }

  yield* Effect.sync(() => {
    restartOrQuit(options.isDevelopment);
  });
});

const writeManifest = async (
  databasePath: string,
  manifest: DatabaseImportManifest
): Promise<void> => {
  const manifestPath = getImportManifestPath(databasePath);
  const temporaryPath = `${manifestPath}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
    });
    await syncFile(temporaryPath);
    // Renamed over the old manifest, never removed first: with no manifest
    // at all, the next start would sweep the staged copy away, beside a
    // database that may be half swapped.
    await rename(temporaryPath, manifestPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
};

const chooseImportFile = async (
  title: string,
  filters: Electron.FileFilter[]
): Promise<string | undefined> => {
  const result = await dialog.showOpenDialog({
    filters,
    properties: ["openFile"],
    title,
  });

  return result.canceled ? undefined : result.filePaths[0];
};

const isExpectedImportFile = (
  filePath: string,
  kind: DatabaseImportFileKind
): boolean => {
  const extension = path.extname(filePath).toLowerCase();

  return kind === "database"
    ? extension === ".db" || extension === ".sqlite" || extension === ".sqlite3"
    : extension === ".kisa-key";
};

export const attachDatabaseImportFile = Effect.fn("attachDatabaseImportFile")(
  function* attachDatabaseImportFileEffect(
    sessionId: string,
    kind: DatabaseImportFileKind,
    filePath: string
  ) {
    const session = databaseImportState;

    if (
      session?.state !== "selecting" ||
      session.sessionId !== sessionId ||
      !isExpectedImportFile(filePath, kind)
    ) {
      return yield* importError();
    }

    const fileInfo = yield* Effect.tryPromise({
      catch: importError,
      try: () => stat(filePath),
    });

    const currentSession = databaseImportState;

    if (
      !fileInfo.isFile() ||
      currentSession?.state !== "selecting" ||
      currentSession.sessionId !== sessionId
    ) {
      return yield* importError();
    }

    databaseImportState =
      kind === "database"
        ? { ...currentSession, databasePath: filePath }
        : { ...currentSession, recoveryKeyPath: filePath };

    return {
      fileName: path.basename(filePath),
    } satisfies DatabaseImportFileSelection;
  }
);

export const beginDatabaseImportSelection = Effect.fn(
  "beginDatabaseImportSelection"
)(function* beginDatabaseImportSelectionEffect() {
  // An import replaces the profile's database at the next start, and the
  // demo profile lasts for one launch. Every later step needs this session.
  if (isDemoMode) {
    return yield* new DatabaseImportError({ message: DEMO_MODE_REFUSAL });
  }

  if (databaseImportState?.state === "importing") {
    return yield* importError();
  }

  const session: DatabaseImportSelectionSession = {
    sessionId: randomUUID(),
    state: "selecting",
  };

  databaseImportState = session;

  return { sessionId: session.sessionId } satisfies DatabaseImportSession;
});

export const cancelDatabaseImportSelection = Effect.fn(
  "cancelDatabaseImportSelection"
)(function* cancelDatabaseImportSelectionEffect(sessionId: string) {
  yield* Effect.sync(() => {
    if (
      databaseImportState?.state === "selecting" &&
      databaseImportState.sessionId === sessionId
    ) {
      databaseImportState = undefined;
    }
  });
});

export const selectDatabaseImportFile = Effect.fn("selectDatabaseImportFile")(
  function* selectDatabaseImportFileEffect(
    sessionId: string,
    kind: DatabaseImportFileKind
  ) {
    const session = databaseImportState;

    if (session?.state !== "selecting" || session.sessionId !== sessionId) {
      return yield* importError();
    }

    const selection = yield* Effect.tryPromise({
      catch: importError,
      try: () =>
        kind === "database"
          ? chooseImportFile("Choose Kisa database", [
              {
                extensions: ["sqlite", "sqlite3", "db"],
                name: "SQLite database",
              },
            ])
          : chooseImportFile("Choose database recovery key", [
              { extensions: ["kisa-key"], name: "Kisa recovery key" },
            ]),
    });

    if (selection === undefined) {
      return null;
    }

    return yield* attachDatabaseImportFile(sessionId, kind, selection);
  }
);

/** Rejects once the import is stopped, so a wait can end with it. */
const stopped = (signal: AbortSignal): Promise<never> => {
  const waiting = Promise.withResolvers<never>();

  const reject = (): void => {
    waiting.reject(importError());
  };

  if (signal.aborted) {
    reject();
  } else {
    signal.addEventListener("abort", reject, { once: true });
  }

  return waiting.promise;
};

/**
 * Waits for one step of the import, or stops waiting when the app quits. A
 * copy cannot itself be interrupted; what it leaves is removed when the
 * import ends, or by the sweep at the next start.
 */
const untilStopped = <A>(step: Promise<A>, signal: AbortSignal): Promise<A> =>
  Promise.race([step, stopped(signal)]);

const offerRestart = async (
  isDevelopment: boolean,
  signal: AbortSignal
): Promise<void> => {
  let result: Electron.MessageBoxReturnValue;

  try {
    result = await untilStopped(
      dialog.showMessageBox({
        buttons: [isDevelopment ? "Quit Now" : "Restart Now", "Later"],
        cancelId: 1,
        defaultId: 0,
        detail: isDevelopment
          ? "Run the development command again after Kisa quits. The imported database will be activated during startup."
          : "Kisa will activate the validated database during startup.",
        message: "The database import is ready.",
        noLink: true,
        signal,
        title: "Restart Kisa to finish",
        type: "info",
      }),
      signal
    );
  } catch {
    // Quit began with the prompt open. The import is staged and waits for
    // the next start; an answer now must not relaunch an app being quit.
    return;
  }

  if (result.response === 0) {
    restartOrQuit(isDevelopment);
  }
};

/**
 * Stops a running import and waits for it to clean up. Quit calls this: an
 * import's handler runs outside the IPC runtime, so disposing that runtime
 * does not interrupt it.
 */
export const stopDatabaseImport = async (): Promise<void> => {
  const running = databaseImportState;

  if (running?.state !== "importing") {
    return;
  }

  await Effect.runPromise(Scope.close(running.stop, Exit.void));
  await running.ended;
};

export const importExistingDatabase = Effect.fn("importExistingDatabase")(
  function* importExistingDatabaseEffect(options: DatabaseImportOptions) {
    const session = databaseImportState;

    if (
      session?.state !== "selecting" ||
      session.sessionId !== options.sessionId ||
      session.databasePath === undefined ||
      session.recoveryKeyPath === undefined ||
      path.resolve(session.databasePath) ===
        path.resolve(options.activeDatabasePath)
    ) {
      return yield* importError();
    }

    const { databasePath: sourceDatabase, recoveryKeyPath } = session;
    const stop = yield* Scope.make();
    const signal = yield* Scope.provide(Effect.abortSignal, stop);
    const ended = Promise.withResolvers<null>();
    databaseImportState = { ended: ended.promise, state: "importing", stop };

    // The copy did not open with its key, or its schema is not one Kisa reads.
    let validationFailed = false;

    return yield* Effect.tryPromise({
      catch: () =>
        validationFailed
          ? new DatabaseImportError({ message: VALIDATION_FAILED_MESSAGE })
          : importError(),
      try: async (): Promise<DatabaseImportOutcome> => {
        const key = decodeDatabaseRecoveryKeyFile(
          await readFile(recoveryKeyPath, "utf-8")
        );

        const directory = path.dirname(options.activeDatabasePath);
        const importId = randomUUID();

        const stagedDatabasePath = path.join(
          directory,
          `${path.basename(options.activeDatabasePath)}.import-${importId}`
        );

        const stagedKeyPath = `${stagedDatabasePath}.key`;
        let isPending = false;

        try {
          options.onProgress("copying");
          await mkdir(directory, { recursive: true });
          await untilStopped(
            copyFile(
              sourceDatabase,
              stagedDatabasePath,
              constants.COPYFILE_EXCL
            ),
            signal
          );
          await chmod(stagedDatabasePath, 0o600);
          await untilStopped(
            copyFileIfPresent(
              `${sourceDatabase}-wal`,
              `${stagedDatabasePath}-wal`
            ),
            signal
          );
          await untilStopped(
            copyFileIfPresent(
              `${sourceDatabase}-shm`,
              `${stagedDatabasePath}-shm`
            ),
            signal
          );

          options.onProgress("validating");

          // A database from before the mail engine fails here: its migration
          // history predates the baseline, so it never replaces the live one.
          try {
            await untilStopped(
              options.validate(stagedDatabasePath, key),
              signal
            );
          } catch (error) {
            // A stop is not a verdict on the database.
            validationFailed = !signal.aborted;
            throw error;
          }

          await rm(`${stagedDatabasePath}-wal`, { force: true });
          await rm(`${stagedDatabasePath}-shm`, { force: true });

          options.onProgress("preparing");
          await untilStopped(
            sealDatabaseKey(stagedKeyPath, key, options.keyEncryptor),
            signal
          );

          // From here the import is carried through: replacing the manifest
          // is short, and half of it would lose the import already waiting.
          await discardPendingImport(options.activeDatabasePath);
          await writeManifest(options.activeDatabasePath, {
            backupDirectory: `before-import-${importId}`,
            databaseFile: path.basename(stagedDatabasePath),
            format: "kisa-database-import",
            keyFile: path.basename(stagedKeyPath),
            step: "pending",
            version: 1,
          });
          isPending = true;
          options.onProgress("ready");
          await offerRestart(options.isDevelopment, signal);

          return "restart-pending";
        } finally {
          key.fill(0);

          if (!isPending) {
            await removeDatabaseFiles(stagedDatabasePath);
            await rm(stagedKeyPath, { force: true });
          }
        }
      },
    }).pipe(
      Effect.ensuring(
        Scope.close(stop, Exit.void).pipe(
          Effect.andThen(
            Effect.sync(() => {
              databaseImportState = undefined;
              ended.resolve(null);
            })
          )
        )
      )
    );
  }
);

const backUpActiveDatabase = async (
  databasePath: string,
  backupDirectory: string
): Promise<void> => {
  await mkdir(backupDirectory, { mode: 0o700, recursive: true });
  await chmod(backupDirectory, 0o700);
  const activeKeyPath = getDatabaseKeyPath(databasePath);

  const files = [
    databasePath,
    activeKeyPath,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
  ];

  await Promise.all(
    files.map((source) =>
      backUpFile(source, path.join(backupDirectory, path.basename(source)))
    )
  );
};

const replaceFileFromStage = async (
  stagedPath: string,
  activePath: string
): Promise<void> => {
  const nextPath = `${activePath}.next-import`;
  await rm(nextPath, { force: true });
  await copyFile(stagedPath, nextPath);
  await chmod(nextPath, 0o600);
  await syncFile(nextPath);
  await rm(activePath, { force: true });
  await rename(nextPath, activePath);
};

interface ActivationPaths {
  readonly backupDirectory: string;
  readonly databasePath: string;
  readonly stagedDatabasePath: string;
  readonly stagedKeyPath: string;
}

const hasStagedFiles = async (paths: ActivationPaths): Promise<boolean> => {
  const [hasDatabase, hasKey] = await Promise.all([
    pathExists(paths.stagedDatabasePath),
    pathExists(paths.stagedKeyPath),
  ]);

  return hasDatabase && hasKey;
};

/** The step the manifest on disk records now. */
const readRecordedStep = async (
  databasePath: string
): Promise<DatabaseImportManifest["step"]> => {
  const manifest = await readManifest(databasePath);

  return manifest?.step;
};

/**
 * A copy left by a replace that was cut short. It can be as large as the
 * database, and the step is written next: on a full disk that write needs
 * the room.
 */
const removeUnfinishedReplacements = async (
  databasePath: string
): Promise<void> => {
  await rm(`${databasePath}.next-import`, { force: true });
  await rm(`${getDatabaseKeyPath(databasePath)}.next-import`, { force: true });
};

const swapInStagedFiles = async (paths: ActivationPaths): Promise<void> => {
  await rm(`${paths.databasePath}-wal`, { force: true });
  await rm(`${paths.databasePath}-shm`, { force: true });
  await replaceFileFromStage(paths.stagedDatabasePath, paths.databasePath);
  await replaceFileFromStage(
    paths.stagedKeyPath,
    getDatabaseKeyPath(paths.databasePath)
  );
};

const finishActivation = async (paths: ActivationPaths): Promise<void> => {
  await rm(getImportManifestPath(paths.databasePath), { force: true });
  await removeDatabaseFiles(paths.stagedDatabasePath);
  await rm(paths.stagedKeyPath, { force: true });
};

/**
 * Ends an import that swapped nothing: the current database and key are as
 * they were. Its backup, if one was begun, only copies files that are still
 * in place, so it goes too; on a full disk that room is what was missing.
 */
const dropUnswappedImport = async (paths: ActivationPaths): Promise<void> => {
  await rm(getImportManifestPath(paths.databasePath), { force: true });

  try {
    await rm(paths.backupDirectory, { force: true, recursive: true });
  } catch {
    // The backup is redundant here; leaving it costs disk space only.
  }

  await sweepStagedImports(paths.databasePath);
};

/**
 * Moves the backup back over the active files. Moved, not copied: a full
 * disk is the likely reason to be here, and a copy needs the room that is
 * missing. A backup file that is gone has already been moved back by an
 * earlier run, which is why this is only entered once `restoring` is
 * recorded. An active `-wal` is never removed: on a second run it is the
 * restored one, and it can hold changes the database file does not.
 */
const restoreFromBackup = async (paths: ActivationPaths): Promise<void> => {
  const activeFiles = [
    paths.databasePath,
    getDatabaseKeyPath(paths.databasePath),
    `${paths.databasePath}-wal`,
    `${paths.databasePath}-shm`,
  ];

  for (const activeFile of activeFiles) {
    const backupFile = path.join(
      paths.backupDirectory,
      path.basename(activeFile)
    );

    // oxlint-disable-next-line eslint/no-await-in-loop -- The database is put back before its key, one file at a time.
    if (await pathExists(backupFile)) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- As above.
      await rename(backupFile, activeFile);
    }
  }

  await rm(getImportManifestPath(paths.databasePath), { force: true });

  try {
    await rmdir(paths.backupDirectory);
  } catch {
    // Not empty, or already gone: either way nothing more to do.
  }

  await sweepStagedImports(paths.databasePath);
};

/**
 * Activation for a manifest that records its step. A failure before the swap
 * drops the import; a failure during it restores the backup. A crash is
 * neither: a start that finds `swapping` with the staged files still there
 * carries the swap on.
 */
const activateRecordedImport = async (
  manifest: DatabaseImportManifest,
  paths: ActivationPaths
): Promise<DatabaseImportActivation> => {
  let { step } = manifest;

  if (step === "pending") {
    if (!(await hasStagedFiles(paths))) {
      await dropUnswappedImport(paths);

      return "dropped";
    }

    try {
      await backUpActiveDatabase(paths.databasePath, paths.backupDirectory);
      await removeUnfinishedReplacements(paths.databasePath);
      await writeManifest(paths.databasePath, {
        ...manifest,
        step: "swapping",
      });
    } catch {
      // What is on disk decides, not where this code was when it threw.
      if ((await readRecordedStep(paths.databasePath)) === "pending") {
        await dropUnswappedImport(paths);

        return "dropped";
      }
    }

    step = await readRecordedStep(paths.databasePath);
  }

  if (step === "swapping") {
    let isSwapped = false;

    if (await hasStagedFiles(paths)) {
      try {
        await swapInStagedFiles(paths);
        isSwapped = true;
      } catch {
        isSwapped = false;
      }
    }

    if (isSwapped) {
      await finishActivation(paths);

      return "activated";
    }

    // The swap cannot be completed. Going back needs the whole backup; a
    // missing file here would be mistaken for one already moved back.
    const [hasBackupDatabase, hasBackupKey, recorded] = await Promise.all([
      pathExists(
        path.join(paths.backupDirectory, path.basename(paths.databasePath))
      ),
      pathExists(
        path.join(
          paths.backupDirectory,
          path.basename(getDatabaseKeyPath(paths.databasePath))
        )
      ),
      readRecordedStep(paths.databasePath),
    ]);

    if (!(hasBackupDatabase && hasBackupKey && recorded === "swapping")) {
      throw importError();
    }

    await removeUnfinishedReplacements(paths.databasePath);
    await writeManifest(paths.databasePath, { ...manifest, step: "restoring" });
    step = "restoring";
  }

  if (step !== "restoring") {
    throw importError();
  }

  await restoreFromBackup(paths);

  return "restored";
};

/**
 * Activation for a manifest from before steps were recorded. How far it got
 * is unknown, so it keeps the rules it was written under: the swap is run
 * (again), and the only import ever dropped is one whose staged files are
 * gone while its backup directory, made before anything is swapped, does
 * not exist.
 */
const activateUnrecordedImport = async (
  paths: ActivationPaths
): Promise<DatabaseImportActivation> => {
  if (!(await hasStagedFiles(paths))) {
    if (await pathExists(paths.backupDirectory)) {
      throw importError();
    }

    await rm(getImportManifestPath(paths.databasePath), { force: true });
    await sweepStagedImports(paths.databasePath);

    return "dropped";
  }

  await backUpActiveDatabase(paths.databasePath, paths.backupDirectory);
  await swapInStagedFiles(paths);
  await finishActivation(paths);

  return "activated";
};

/**
 * Activates a waiting import at startup, before the database opens, and says
 * what it did. It shows nothing itself: it also runs when no window exists.
 *
 * A manifest whose contents do not decode names nothing that can be
 * activated, so it is dropped and the app starts with the current database.
 */
export const activatePendingDatabaseImport = async (
  databasePath: string
): Promise<DatabaseImportActivation> => {
  let manifest: DatabaseImportManifest | undefined;

  try {
    manifest = await readManifest(databasePath);
  } catch (error) {
    // Only contents that do not decode. A manifest that cannot be read from
    // disk at all may be a good one, so that still fails the start.
    if (!(error instanceof DatabaseImportError)) {
      throw error;
    }

    await rm(getImportManifestPath(databasePath), { force: true });
    await sweepStagedImports(databasePath);

    return "dropped";
  }

  if (manifest === undefined) {
    await sweepStagedImports(databasePath);

    return "none";
  }

  const directory = path.dirname(databasePath);

  const paths: ActivationPaths = {
    backupDirectory: path.join(directory, "backups", manifest.backupDirectory),
    databasePath,
    stagedDatabasePath: path.join(directory, manifest.databaseFile),
    stagedKeyPath: path.join(directory, manifest.keyFile),
  };

  return manifest.step === undefined
    ? await activateUnrecordedImport(paths)
    : await activateRecordedImport(manifest, paths);
};
