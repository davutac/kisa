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
    state.messageBox.mockReset();
    state.messageBox.mockReturnValueOnce(answered.promise);

    const running = runImport(sessionId);
    await vi.waitFor(() => {
      expect(state.messageBox).toHaveBeenCalledOnce();
    });
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
    ).resolves.toBeUndefined();
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
    ).resolves.toBeUndefined();
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
});
