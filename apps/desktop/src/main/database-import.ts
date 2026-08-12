import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { Effect, Schema } from "effect";
import { app, dialog } from "electron";

import type {
  DatabaseImportFileKind,
  DatabaseImportFileSelection,
  DatabaseImportOutcome,
  DatabaseImportProgress,
  DatabaseImportSession,
} from "../shared/ipc/settings";
import type { DatabaseKeyEncryptor } from "./database-key";
import { sealDatabaseKey } from "./database-key";
import { getDatabaseKeyPath } from "./database-path";
import { decodeDatabaseRecoveryKeyFile } from "./database-recovery-key";

const DatabaseImportManifest = Schema.Struct({
  backupDirectory: Schema.String,
  databaseFile: Schema.String,
  format: Schema.Literal("kisa-database-import"),
  keyFile: Schema.String,
  version: Schema.Literal(1),
});
type DatabaseImportManifest = typeof DatabaseImportManifest.Type;

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

type DatabaseImportState =
  | DatabaseImportSelectionSession
  | { readonly state: "importing" }
  | undefined;

let databaseImportState: DatabaseImportState;

// oxlint-disable-next-line unicorn/throw-new-error
class DatabaseImportError extends Schema.TaggedError<DatabaseImportError>()(
  "DatabaseImportError",
  { message: Schema.String }
) {}

const importError = (): DatabaseImportError =>
  new DatabaseImportError({ message: "Could not import the database" });

const getImportManifestPath = (databasePath: string): string =>
  `${databasePath}.pending-import.json`;

const isMissingFileError = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const isExistingFileError = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "EEXIST";

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

  const databasePrefix = `${path.basename(databasePath)}.import-`;
  if (
    path.basename(manifest.databaseFile) !== manifest.databaseFile ||
    !manifest.databaseFile.startsWith(databasePrefix) ||
    manifest.keyFile !== `${manifest.databaseFile}.key` ||
    path.basename(manifest.backupDirectory) !== manifest.backupDirectory ||
    !manifest.backupDirectory.startsWith("before-import-")
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
  destination: string,
  exclusive = false
): Promise<void> => {
  try {
    await copyFile(
      source,
      destination,
      exclusive ? constants.COPYFILE_EXCL : 0
    );
    await chmod(destination, 0o600);
  } catch (error) {
    if (
      isMissingFileError(error) ||
      (exclusive && isExistingFileError(error))
    ) {
      return;
    }
    if (exclusive) {
      await rm(destination, { force: true });
    }
    throw error;
  }
};

const removeDatabaseFiles = async (databasePath: string): Promise<void> => {
  await Promise.all([
    rm(databasePath, { force: true }),
    rm(`${databasePath}-shm`, { force: true }),
    rm(`${databasePath}-wal`, { force: true }),
  ]);
};

const discardPendingImport = async (databasePath: string): Promise<void> => {
  const manifest = await readManifest(databasePath);
  if (manifest === undefined) {
    return;
  }

  const directory = path.dirname(databasePath);
  await removeDatabaseFiles(path.join(directory, manifest.databaseFile));
  await rm(path.join(directory, manifest.keyFile), { force: true });
  await rm(getImportManifestPath(databasePath), { force: true });
};

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
    await rm(manifestPath, { force: true });
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

const offerRestart = async (isDevelopment: boolean): Promise<void> => {
  const result = await dialog.showMessageBox({
    buttons: [isDevelopment ? "Quit Now" : "Restart Now", "Later"],
    cancelId: 1,
    defaultId: 0,
    detail: isDevelopment
      ? "Run the development command again after Kisa quits. The imported database will be activated during startup."
      : "Kisa will activate the validated database during startup.",
    message: "The database import is ready.",
    noLink: true,
    title: "Restart Kisa to finish",
    type: "info",
  });

  if (result.response === 0) {
    if (!isDevelopment) {
      app.relaunch();
    }
    app.quit();
  }
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
    databaseImportState = { state: "importing" };

    return yield* Effect.tryPromise({
      catch: importError,
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
          await copyFile(
            sourceDatabase,
            stagedDatabasePath,
            constants.COPYFILE_EXCL
          );
          await chmod(stagedDatabasePath, 0o600);
          await copyFileIfPresent(
            `${sourceDatabase}-wal`,
            `${stagedDatabasePath}-wal`
          );
          await copyFileIfPresent(
            `${sourceDatabase}-shm`,
            `${stagedDatabasePath}-shm`
          );

          options.onProgress("validating");
          await options.validate(stagedDatabasePath, key);
          await rm(`${stagedDatabasePath}-wal`, { force: true });
          await rm(`${stagedDatabasePath}-shm`, { force: true });

          options.onProgress("preparing");
          await sealDatabaseKey(stagedKeyPath, key, options.keyEncryptor);

          await discardPendingImport(options.activeDatabasePath);
          await writeManifest(options.activeDatabasePath, {
            backupDirectory: `before-import-${importId}`,
            databaseFile: path.basename(stagedDatabasePath),
            format: "kisa-database-import",
            keyFile: path.basename(stagedKeyPath),
            version: 1,
          });
          isPending = true;
          options.onProgress("ready");
          await offerRestart(options.isDevelopment);
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
        Effect.sync(() => {
          databaseImportState = undefined;
        })
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
      copyFileIfPresent(
        source,
        path.join(backupDirectory, path.basename(source)),
        true
      )
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

export const activatePendingDatabaseImport = async (
  databasePath: string
): Promise<void> => {
  const manifest = await readManifest(databasePath);
  if (manifest === undefined) {
    return;
  }

  const directory = path.dirname(databasePath);
  const stagedDatabasePath = path.join(directory, manifest.databaseFile);
  const stagedKeyPath = path.join(directory, manifest.keyFile);
  await Promise.all([stat(stagedDatabasePath), stat(stagedKeyPath)]);

  await backUpActiveDatabase(
    databasePath,
    path.join(directory, "backups", manifest.backupDirectory)
  );
  await rm(`${databasePath}-wal`, { force: true });
  await rm(`${databasePath}-shm`, { force: true });
  await replaceFileFromStage(stagedDatabasePath, databasePath);
  await replaceFileFromStage(stagedKeyPath, getDatabaseKeyPath(databasePath));
  await rm(getImportManifestPath(databasePath), { force: true });
  await removeDatabaseFiles(stagedDatabasePath);
  await rm(stagedKeyPath, { force: true });
};
