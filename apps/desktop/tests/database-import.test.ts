// The Electron adapter is intentionally partial so this test stays at the
// native database-import boundary.
// oxlint-disable vitest/prefer-import-in-mock
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Effect } from "effect";
import type * as Electron from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  activatePendingDatabaseImport,
  attachDatabaseImportFile,
  beginDatabaseImportSelection,
  cancelDatabaseImportSelection,
  discardPendingDatabaseImport,
  getDatabaseImportStatus,
  importExistingDatabase,
  restartForPendingDatabaseImport,
  selectDatabaseImportFile,
  stopDatabaseImport,
} from "../src/main/database-import";
import { encodeDatabaseRecoveryKeyFile } from "../src/main/database-recovery-key";

const state = vi.hoisted(() => ({
  messageBox:
    vi.fn<
      (
        options: Electron.MessageBoxOptions
      ) => Promise<Electron.MessageBoxReturnValue>
    >(),
  openDialog:
    vi.fn<
      (
        options: Electron.OpenDialogOptions
      ) => Promise<Electron.OpenDialogReturnValue>
    >(),
  quit: vi.fn<() => void>(),
  relaunch: vi.fn<() => void>(),
}));

vi.mock("electron", () => ({
  app: { quit: state.quit, relaunch: state.relaunch },
  dialog: {
    showMessageBox: state.messageBox,
    showOpenDialog: state.openDialog,
  },
}));

const exists = async (filePath: string): Promise<boolean> => {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
};

/** How a promise ended: its failure's message, or nothing if it resolved. */
const failureOf = async (
  promise: Promise<unknown>
): Promise<string | undefined> => {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

interface StoredManifest {
  readonly backupDirectory: string;
  readonly databaseFile: string;
  readonly keyFile: string;
  readonly step?: "pending" | "restoring" | "swapping";
}

describe("database import", () => {
  let activeDatabasePath = "";
  let sourceDatabasePath = "";
  let recoveryKeyPath = "";
  let temporaryDirectory = "";

  const keyEncryptor = {
    encrypt: (plaintext: string) =>
      Promise.resolve(Buffer.from(`sealed:${plaintext}`)),
  };

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "kisa-database-import-")
    );
    activeDatabasePath = path.join(temporaryDirectory, "app.sqlite");
    sourceDatabasePath = path.join(temporaryDirectory, "source.sqlite");
    recoveryKeyPath = path.join(temporaryDirectory, "source.kisa-key");
    await writeFile(activeDatabasePath, "current database");
    await writeFile(`${activeDatabasePath}.key`, "current sealed key");
    await writeFile(`${activeDatabasePath}-wal`, "current wal");
    await writeFile(sourceDatabasePath, "imported database");
    await writeFile(
      recoveryKeyPath,
      encodeDatabaseRecoveryKeyFile(Buffer.alloc(32, 7))
    );
    state.messageBox.mockReset();
    state.openDialog.mockReset();
    state.quit.mockReset();
    state.relaunch.mockReset();
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { force: true, recursive: true });
  });

  const prepareImport = async (restartResponse = 1): Promise<string> => {
    state.messageBox.mockResolvedValueOnce({
      checkboxChecked: false,
      response: restartResponse,
    });
    state.openDialog
      .mockResolvedValueOnce({
        canceled: false,
        filePaths: [sourceDatabasePath],
      })
      .mockResolvedValueOnce({
        canceled: false,
        filePaths: [recoveryKeyPath],
      });

    const { sessionId } = await Effect.runPromise(
      beginDatabaseImportSelection()
    );
    await expect(
      Effect.runPromise(selectDatabaseImportFile(sessionId, "database"))
    ).resolves.toStrictEqual({ fileName: "source.sqlite" });
    await expect(
      Effect.runPromise(selectDatabaseImportFile(sessionId, "recovery-key"))
    ).resolves.toStrictEqual({ fileName: "source.kisa-key" });
    return sessionId;
  };

  const runImport = (
    sessionId: string,
    options: {
      isDevelopment?: boolean;
      onProgress?: (phase: string) => void;
      validate?: (databasePath: string, key: Uint8Array) => Promise<void>;
    } = {}
  ) =>
    Effect.runPromise(
      importExistingDatabase({
        activeDatabasePath,
        isDevelopment: options.isDevelopment ?? false,
        keyEncryptor,
        onProgress: options.onProgress ?? (() => {}),
        sessionId,
        validate: options.validate ?? (() => Promise.resolve()),
      })
    );

  it("validates a staged copy and activates it on restart with a backup", async () => {
    const progress: string[] = [];
    let validatedContents = "";
    let validatedKey = Buffer.alloc(0);
    const validate = vi.fn<
      (databasePath: string, key: Uint8Array) => Promise<void>
    >(async (databasePath, key) => {
      validatedContents = await readFile(databasePath, "utf-8");
      validatedKey = Buffer.from(key);
    });
    const sessionId = await prepareImport();

    await expect(
      runImport(sessionId, {
        onProgress: (phase) => progress.push(phase),
        validate,
      })
    ).resolves.toBe("restart-pending");
    const activeBeforeRestart = await readFile(activeDatabasePath, "utf-8");
    expect(validate).toHaveBeenCalledOnce();

    await activatePendingDatabaseImport(activeDatabasePath);

    const backupRoot = path.join(temporaryDirectory, "backups");
    const backupDirectories = await readdir(backupRoot);
    const backupDirectory = path.join(backupRoot, backupDirectories[0] ?? "");
    const [activeDatabase, activeKey, backupDatabase, backupKey, backupWal] =
      await Promise.all([
        readFile(activeDatabasePath, "utf-8"),
        readFile(`${activeDatabasePath}.key`, "utf-8"),
        readFile(path.join(backupDirectory, "app.sqlite"), "utf-8"),
        readFile(path.join(backupDirectory, "app.sqlite.key"), "utf-8"),
        readFile(path.join(backupDirectory, "app.sqlite-wal"), "utf-8"),
      ]);

    expect(progress).toStrictEqual([
      "copying",
      "validating",
      "preparing",
      "ready",
    ]);
    expect({
      activeBeforeRestart,
      activeDatabase,
      activeKey,
      backupDatabase,
      backupDirectories: backupDirectories.length,
      backupKey,
      backupWal,
      validatedContents,
      validatedKey,
    }).toStrictEqual({
      activeBeforeRestart: "current database",
      activeDatabase: "imported database",
      activeKey: `sealed:${Buffer.alloc(32, 7).toString("base64")}`,
      backupDatabase: "current database",
      backupDirectories: 1,
      backupKey: "current sealed key",
      backupWal: "current wal",
      validatedContents: "imported database",
      validatedKey: Buffer.alloc(32, 7),
    });
  });

  it("cancels a selection session before import starts", async () => {
    const { sessionId } = await Effect.runPromise(
      beginDatabaseImportSelection()
    );
    await Effect.runPromise(cancelDatabaseImportSelection(sessionId));

    await expect(runImport(sessionId)).rejects.toThrow(
      "Could not import the database"
    );
    expect(state.openDialog).not.toHaveBeenCalled();
  });

  it("keeps the session open when a file picker is cancelled", async () => {
    state.openDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const { sessionId } = await Effect.runPromise(
      beginDatabaseImportSelection()
    );

    await expect(
      Effect.runPromise(selectDatabaseImportFile(sessionId, "database"))
    ).resolves.toBeNull();
    await Effect.runPromise(cancelDatabaseImportSelection(sessionId));
  });

  it("rejects a dropped file that does not match its import slot", async () => {
    const { sessionId } = await Effect.runPromise(
      beginDatabaseImportSelection()
    );

    await expect(
      Effect.runPromise(
        attachDatabaseImportFile(sessionId, "recovery-key", sourceDatabasePath)
      )
    ).rejects.toThrow("Could not import the database");
    await Effect.runPromise(cancelDatabaseImportSelection(sessionId));
  });

  it("attaches dropped files without returning their paths", async () => {
    const { sessionId } = await Effect.runPromise(
      beginDatabaseImportSelection()
    );

    await expect(
      Effect.runPromise(
        attachDatabaseImportFile(sessionId, "database", sourceDatabasePath)
      )
    ).resolves.toStrictEqual({ fileName: "source.sqlite" });
    await expect(
      Effect.runPromise(
        attachDatabaseImportFile(sessionId, "recovery-key", recoveryKeyPath)
      )
    ).resolves.toStrictEqual({ fileName: "source.kisa-key" });
    await Effect.runPromise(cancelDatabaseImportSelection(sessionId));
  });

  it("quits without relaunching when development owns the renderer server", async () => {
    const sessionId = await prepareImport(0);

    await expect(runImport(sessionId, { isDevelopment: true })).resolves.toBe(
      "restart-pending"
    );
    expect(state.quit).toHaveBeenCalledOnce();
    expect(state.relaunch).not.toHaveBeenCalled();
    expect(state.messageBox).toHaveBeenLastCalledWith(
      expect.objectContaining({ buttons: ["Quit Now", "Later"] })
    );
  });

  it("relaunches a packaged app after staging the import", async () => {
    const sessionId = await prepareImport(0);

    await expect(runImport(sessionId)).resolves.toBe("restart-pending");
    expect(state.relaunch).toHaveBeenCalledOnce();
    expect(state.quit).toHaveBeenCalledOnce();
    expect(state.messageBox).toHaveBeenLastCalledWith(
      expect.objectContaining({ buttons: ["Restart Now", "Later"] })
    );
  });

  it("leaves the active database untouched when validation fails", async () => {
    const sessionId = await prepareImport();

    await expect(
      runImport(sessionId, {
        validate: () => Promise.reject(new Error("wrong key")),
      })
    ).rejects.toThrow(
      "Databases from Kisa versions before the IMAP mail engine can't be imported"
    );
    const [activeDatabase, directoryEntries] = await Promise.all([
      readFile(activeDatabasePath, "utf-8"),
      readdir(temporaryDirectory),
    ]);
    expect({
      activeDatabase,
      hasPendingImport: directoryEntries.some((name) =>
        name.includes("pending-import")
      ),
    }).toStrictEqual({
      activeDatabase: "current database",
      hasPendingImport: false,
    });
  });

  const importStatus = (isDevelopment = false) =>
    Effect.runPromise(
      getDatabaseImportStatus({ activeDatabasePath, isDevelopment })
    );

  const stagedFiles = async (): Promise<string[]> => {
    const names = await readdir(temporaryDirectory);
    return names.filter((name) => name.includes(".import-"));
  };

  it("reports a waiting import from the manifest, and what restarting will do", async () => {
    await expect(importStatus()).resolves.toStrictEqual({
      restart: "relaunch",
      state: "none",
    });

    await runImport(await prepareImport());

    await expect(importStatus()).resolves.toStrictEqual({
      restart: "relaunch",
      state: "restart-pending",
    });
    await expect(importStatus(true)).resolves.toStrictEqual({
      restart: "quit",
      state: "restart-pending",
    });
  });

  it("reports an import as running until its restart prompt is answered", async () => {
    const sessionId = await prepareImport();
    const answered = Promise.withResolvers<Electron.MessageBoxReturnValue>();
    const prompted = Promise.withResolvers<null>();
    state.messageBox.mockReset();
    state.messageBox.mockImplementationOnce(() => {
      prompted.resolve(null);
      return answered.promise;
    });

    const running = runImport(sessionId);
    await prompted.promise;
    expect(state.messageBox).toHaveBeenCalledOnce();
    await expect(importStatus()).resolves.toMatchObject({ state: "importing" });
    await expect(
      Effect.runPromise(discardPendingDatabaseImport(activeDatabasePath))
    ).rejects.toMatchObject({ message: "Could not discard the import" });

    answered.resolve({ checkboxChecked: false, response: 1 });
    await running;
    await expect(importStatus()).resolves.toMatchObject({
      state: "restart-pending",
    });
  });

  it("discards a waiting import and leaves the current database alone", async () => {
    await runImport(await prepareImport());

    await Effect.runPromise(discardPendingDatabaseImport(activeDatabasePath));

    await expect(importStatus()).resolves.toMatchObject({ state: "none" });
    await expect(stagedFiles()).resolves.toStrictEqual([]);
    await activatePendingDatabaseImport(activeDatabasePath);
    await expect(readFile(activeDatabasePath, "utf-8")).resolves.toBe(
      "current database"
    );
    await expect(readFile(`${activeDatabasePath}.key`, "utf-8")).resolves.toBe(
      "current sealed key"
    );
  });

  // A manifest left pointing at files already removed fails every later
  // start, so it has to go before them.
  it("removes the manifest first, so a discard that fails part-way cannot block the next start", async () => {
    await runImport(await prepareImport());
    const names = await stagedFiles();
    const stagedKey = path.join(
      temporaryDirectory,
      names.find((name) => name.endsWith(".key")) ?? ""
    );
    // A directory with content where the staged key was: removing it fails.
    await rm(stagedKey);
    await mkdir(stagedKey);
    await writeFile(path.join(stagedKey, "blocker"), "x");

    await expect(
      Effect.runPromise(discardPendingDatabaseImport(activeDatabasePath))
    ).rejects.toMatchObject({ message: "Could not discard the import" });

    await expect(importStatus()).resolves.toMatchObject({ state: "none" });
    await expect(
      activatePendingDatabaseImport(activeDatabasePath)
    ).resolves.toBe("none");
    await expect(readFile(activeDatabasePath, "utf-8")).resolves.toBe(
      "current database"
    );
  });

  it("discards a manifest it cannot read, so the next start is not blocked", async () => {
    await writeFile(`${activeDatabasePath}.pending-import.json`, "not json");
    await expect(importStatus()).resolves.toMatchObject({
      state: "restart-pending",
    });

    await Effect.runPromise(discardPendingDatabaseImport(activeDatabasePath));

    await expect(importStatus()).resolves.toMatchObject({ state: "none" });
    await expect(
      activatePendingDatabaseImport(activeDatabasePath)
    ).resolves.toBe("none");
    await expect(readFile(activeDatabasePath, "utf-8")).resolves.toBe(
      "current database"
    );
  });

  it("restarts for a waiting import: a relaunch when packaged, a quit in development", async () => {
    await runImport(await prepareImport());

    await Effect.runPromise(
      restartForPendingDatabaseImport({
        activeDatabasePath,
        isDevelopment: false,
      })
    );
    expect(state.relaunch).toHaveBeenCalledOnce();
    expect(state.quit).toHaveBeenCalledOnce();

    await Effect.runPromise(
      restartForPendingDatabaseImport({
        activeDatabasePath,
        isDevelopment: true,
      })
    );
    expect(state.relaunch).toHaveBeenCalledOnce();
    expect(state.quit).toHaveBeenCalledTimes(2);
  });

  it("refuses to restart when no import is waiting", async () => {
    await expect(
      Effect.runPromise(
        restartForPendingDatabaseImport({
          activeDatabasePath,
          isDevelopment: false,
        })
      )
    ).rejects.toMatchObject({
      message: "Could not restart to finish the import",
    });
    expect(state.quit).not.toHaveBeenCalled();
  });

  const manifestPath = (): string =>
    `${activeDatabasePath}.pending-import.json`;

  const readPendingManifest = async (): Promise<{
    readonly backupDirectory: string;
    readonly databaseFile: string;
    readonly keyFile: string;
  }> => JSON.parse(await readFile(manifestPath(), "utf-8"));

  const activeDatabase = (): Promise<string> =>
    readFile(activeDatabasePath, "utf-8");

  const readStoredManifest = async (): Promise<StoredManifest> =>
    JSON.parse(await readFile(manifestPath(), "utf-8"));

  /** Rewrites the waiting manifest's step; `undefined` removes it. */
  const recordStep = async (step: StoredManifest["step"]): Promise<void> => {
    const { step: _recorded, ...manifest } = await readStoredManifest();
    await writeFile(
      manifestPath(),
      JSON.stringify(step === undefined ? manifest : { ...manifest, step })
    );
  };

  const recordedStep = async (): Promise<StoredManifest["step"]> => {
    const manifest = await readStoredManifest();
    return manifest.step;
  };

  const backupPath = async (name: string): Promise<string> => {
    const manifest = await readPendingManifest();
    return path.join(
      temporaryDirectory,
      "backups",
      manifest.backupDirectory,
      name
    );
  };

  /** The backup as activation leaves it once it is complete. */
  const writeCompleteBackup = async (): Promise<void> => {
    await mkdir(path.dirname(await backupPath("app.sqlite")), {
      recursive: true,
    });
    await writeFile(await backupPath("app.sqlite"), "current database");
    await writeFile(await backupPath("app.sqlite.key"), "current sealed key");
    await writeFile(await backupPath("app.sqlite-wal"), "current wal");
  };

  const activeFiles = async () => ({
    database: await readFile(activeDatabasePath, "utf-8"),
    key: await readFile(`${activeDatabasePath}.key`, "utf-8"),
    wal: await readFile(`${activeDatabasePath}-wal`, "utf-8"),
  });

  const CURRENT_FILES = {
    database: "current database",
    key: "current sealed key",
    wal: "current wal",
  };

  it("starts with the current database when the manifest cannot be read", async () => {
    await writeFile(manifestPath(), "not json");

    await expect(
      activatePendingDatabaseImport(activeDatabasePath)
    ).resolves.toBe("dropped");

    await expect(activeDatabase()).resolves.toBe("current database");
    await expect(exists(manifestPath())).resolves.toBeFalsy();
  });

  it("starts with the current database when the staged copy is gone and nothing was swapped", async () => {
    await runImport(await prepareImport());
    const manifest = await readPendingManifest();
    await rm(path.join(temporaryDirectory, manifest.databaseFile));

    await expect(
      activatePendingDatabaseImport(activeDatabasePath)
    ).resolves.toBe("dropped");

    await expect(activeDatabase()).resolves.toBe("current database");
    await expect(exists(manifestPath())).resolves.toBeFalsy();
    await expect(stagedFiles()).resolves.toStrictEqual([]);
    await expect(readdir(temporaryDirectory)).resolves.not.toContain("backups");
  });

  // A manifest from before steps were recorded: how far it got is unknown.
  // The backup directory is made before anything is swapped, so finding it
  // means the swap may have begun and the current pair may not be whole.
  it("keeps failing, and deletes nothing, when an unrecorded import's staged copy is gone after its swap began", async () => {
    await runImport(await prepareImport());
    await recordStep(undefined);
    const manifest = await readPendingManifest();
    await mkdir(
      path.join(temporaryDirectory, "backups", manifest.backupDirectory),
      { recursive: true }
    );
    await rm(path.join(temporaryDirectory, manifest.databaseFile));

    await expect(
      activatePendingDatabaseImport(activeDatabasePath)
    ).rejects.toThrow(/./u);

    await expect(exists(manifestPath())).resolves.toBeTruthy();
    await expect(
      exists(path.join(temporaryDirectory, manifest.keyFile))
    ).resolves.toBeTruthy();
  });

  it("records that nothing is swapped when an import is staged", async () => {
    await runImport(await prepareImport());

    await expect(recordedStep()).resolves.toBe("pending");
  });

  it("drops an import whose backup cannot be made, leaving the current database untouched", async () => {
    await runImport(await prepareImport());
    // A file where the backups folder belongs: the backup cannot begin.
    await writeFile(path.join(temporaryDirectory, "backups"), "in the way");

    await expect(
      activatePendingDatabaseImport(activeDatabasePath)
    ).resolves.toBe("dropped");

    await expect(activeFiles()).resolves.toStrictEqual(CURRENT_FILES);
    await expect(exists(manifestPath())).resolves.toBeFalsy();
    await expect(stagedFiles()).resolves.toStrictEqual([]);
  });

  it("puts the previous database, key and journal back when the swap fails part-way", async () => {
    await runImport(await prepareImport());
    const manifest = await readPendingManifest();
    const stagedKey = path.join(temporaryDirectory, manifest.keyFile);
    // The database swaps, then the key cannot be copied.
    await rm(stagedKey);
    await mkdir(stagedKey);

    await expect(
      activatePendingDatabaseImport(activeDatabasePath)
    ).resolves.toBe("restored");

    await expect(activeFiles()).resolves.toStrictEqual(CURRENT_FILES);
    await expect(exists(manifestPath())).resolves.toBeFalsy();
    await expect(
      activatePendingDatabaseImport(activeDatabasePath)
    ).resolves.toBe("none");
  });

  // A crash is not a failure: the staged files are still there, so the swap
  // is carried on. The backup already holds the original and the active file
  // is now the imported one, so the backup must not be made again.
  it("carries on a swap cut short by a crash, without making the backup again", async () => {
    await runImport(await prepareImport());
    await writeCompleteBackup();
    await writeFile(activeDatabasePath, "imported database");
    await recordStep("swapping");
    const backupDatabase = await backupPath("app.sqlite");

    await expect(
      activatePendingDatabaseImport(activeDatabasePath)
    ).resolves.toBe("activated");

    await expect(readFile(backupDatabase, "utf-8")).resolves.toBe(
      "current database"
    );
    await expect(activeDatabase()).resolves.toBe("imported database");
    await expect(readFile(`${activeDatabasePath}.key`, "utf-8")).resolves.toBe(
      `sealed:${Buffer.alloc(32, 7).toString("base64")}`
    );
  });

  it("finishes a restore that was cut short, without activating the import", async () => {
    await runImport(await prepareImport());
    await writeCompleteBackup();
    // The database was already moved back; the key and journal were not.
    await rm(await backupPath("app.sqlite"));
    await writeFile(`${activeDatabasePath}.key`, "imported sealed key");
    await rm(`${activeDatabasePath}-wal`);
    await recordStep("restoring");

    await expect(
      activatePendingDatabaseImport(activeDatabasePath)
    ).resolves.toBe("restored");

    await expect(activeFiles()).resolves.toStrictEqual(CURRENT_FILES);
    await expect(exists(manifestPath())).resolves.toBeFalsy();
  });

  it("fails, and deletes nothing, when a begun swap can neither finish nor be undone", async () => {
    await runImport(await prepareImport());
    const manifest = await readPendingManifest();
    await rm(path.join(temporaryDirectory, manifest.databaseFile));
    await recordStep("swapping");

    await expect(
      activatePendingDatabaseImport(activeDatabasePath)
    ).rejects.toThrow(/./u);

    await expect(recordedStep()).resolves.toBe("swapping");
    await expect(activeFiles()).resolves.toStrictEqual(CURRENT_FILES);
    await expect(
      exists(path.join(temporaryDirectory, manifest.keyFile))
    ).resolves.toBeTruthy();
  });

  const OTHER_BACKUP = "before-import-22222222-2222-2222-2222-222222222222";

  /** An earlier import's backup: the only copy of what it replaced. */
  const writeOtherBackup = async (): Promise<string> => {
    const directory = path.join(temporaryDirectory, "backups", OTHER_BACKUP);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "app.sqlite"), "earlier original");
    return path.join(directory, "app.sqlite");
  };

  // The folder a drop deletes, and a restore moves files out of, is named by
  // the manifest. It must be the one this import made.
  it("never touches a backup folder the import did not make, whatever its manifest names", async () => {
    await runImport(await prepareImport());
    const otherBackup = await writeOtherBackup();
    const manifest = await readStoredManifest();
    await writeFile(
      manifestPath(),
      JSON.stringify({ ...manifest, backupDirectory: OTHER_BACKUP })
    );
    await rm(path.join(temporaryDirectory, manifest.databaseFile));

    await activatePendingDatabaseImport(activeDatabasePath);

    await expect(readFile(otherBackup, "utf-8")).resolves.toBe(
      "earlier original"
    );
    await expect(activeFiles()).resolves.toStrictEqual(CURRENT_FILES);
  });

  it("removes its own half-made backup on a drop and leaves a neighbouring backup alone", async () => {
    await runImport(await prepareImport());
    const otherBackup = await writeOtherBackup();
    const manifest = await readStoredManifest();
    const ownBackup = path.dirname(await backupPath("app.sqlite"));
    await mkdir(ownBackup, { recursive: true });
    await writeFile(path.join(ownBackup, "app.sqlite.partial"), "curr");
    await rm(path.join(temporaryDirectory, manifest.databaseFile));

    await expect(
      activatePendingDatabaseImport(activeDatabasePath)
    ).resolves.toBe("dropped");

    await expect(
      exists(path.join(ownBackup, "app.sqlite.partial"))
    ).resolves.toBeFalsy();
    await expect(readFile(otherBackup, "utf-8")).resolves.toBe(
      "earlier original"
    );
  });

  it("refuses to discard an import whose swap has begun", async () => {
    await runImport(await prepareImport());
    await recordStep("swapping");

    await expect(
      Effect.runPromise(discardPendingDatabaseImport(activeDatabasePath))
    ).rejects.toMatchObject({ message: "Could not discard the import" });

    await expect(recordedStep()).resolves.toBe("swapping");
    await expect(stagedFiles()).resolves.toHaveLength(2);
  });

  // A copy cut short by a crash must not stand in for the backup: the next
  // step removes the current database.
  it("never takes a copy that was cut short for the backup", async () => {
    await runImport(await prepareImport());
    const manifest = await readPendingManifest();
    const backupDirectory = path.join(
      temporaryDirectory,
      "backups",
      manifest.backupDirectory
    );
    await mkdir(backupDirectory, { recursive: true });
    await writeFile(path.join(backupDirectory, "app.sqlite.partial"), "curr");

    await activatePendingDatabaseImport(activeDatabasePath);

    await expect(
      readFile(path.join(backupDirectory, "app.sqlite"), "utf-8")
    ).resolves.toBe("current database");
    await expect(readdir(backupDirectory)).resolves.toStrictEqual([
      "app.sqlite",
      "app.sqlite-wal",
      "app.sqlite.key",
    ]);
  });

  it("removes staged copies that no manifest names, and nothing else", async () => {
    const orphan = `app.sqlite.import-${"1".repeat(8)}-1111-1111-1111-${"1".repeat(12)}`;
    const kept = [
      "app.dev.sqlite.import-11111111-1111-1111-1111-111111111111",
      "app.sqlite.import-notes.txt",
      "app.sqlite.imported",
      `${orphan}.bak`,
    ];
    await Promise.all(
      [orphan, `${orphan}-wal`, `${orphan}-shm`, `${orphan}.key`, ...kept].map(
        (name) => writeFile(path.join(temporaryDirectory, name), "x")
      )
    );

    await activatePendingDatabaseImport(activeDatabasePath);

    const names = await readdir(temporaryDirectory);
    expect(names.filter((name) => name.startsWith(orphan))).toStrictEqual([
      `${orphan}.bak`,
    ]);
    expect(names).toStrictEqual(expect.arrayContaining(kept));
    await expect(activeDatabase()).resolves.toBe("current database");
  });

  it("leaves a running import's copy alone, then stops it on quit and removes the copy", async () => {
    const sessionId = await prepareImport();
    const validating = Promise.withResolvers<null>();
    const running = runImport(sessionId, {
      validate: () => {
        validating.resolve(null);
        // Never finishes: only the stop ends it.
        return Promise.withResolvers<undefined>().promise;
      },
    });
    const settled = failureOf(running);
    await validating.promise;

    await activatePendingDatabaseImport(activeDatabasePath);
    const whileRunning = await stagedFiles();
    await stopDatabaseImport();

    expect(whileRunning).toHaveLength(1);
    await expect(settled).resolves.toBe("Could not import the database");
    await expect(stagedFiles()).resolves.toStrictEqual([]);
    await expect(exists(manifestPath())).resolves.toBeFalsy();
  });

  it("ignores an answer to the restart prompt that comes after quit began", async () => {
    const sessionId = await prepareImport();
    const answered = Promise.withResolvers<Electron.MessageBoxReturnValue>();
    const prompted = Promise.withResolvers<null>();
    state.messageBox.mockReset();
    state.messageBox.mockImplementationOnce(() => {
      prompted.resolve(null);
      return answered.promise;
    });
    const running = runImport(sessionId);
    await prompted.promise;
    expect(state.messageBox).toHaveBeenCalledOnce();

    await stopDatabaseImport();
    await expect(running).resolves.toBe("restart-pending");
    answered.resolve({ checkboxChecked: false, response: 0 });
    await Promise.resolve();

    expect(state.relaunch).not.toHaveBeenCalled();
    expect(state.quit).not.toHaveBeenCalled();
    await expect(exists(manifestPath())).resolves.toBeTruthy();
  });
});
