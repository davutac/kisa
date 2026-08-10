// The Electron adapter is intentionally partial so this test stays at the
// native recovery-key export boundary.
// oxlint-disable vitest/prefer-import-in-mock
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Effect } from "effect";
import type * as Electron from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  decodeDatabaseRecoveryKeyFile,
  encodeDatabaseRecoveryKeyFile,
  exportDatabaseRecoveryKey,
} from "../src/main/database-recovery-key";

const state = vi.hoisted(() => ({
  messageBox:
    vi.fn<
      (
        options: Electron.MessageBoxOptions
      ) => Promise<Electron.MessageBoxReturnValue>
    >(),
  saveDialog:
    vi.fn<
      (
        options: Electron.SaveDialogOptions
      ) => Promise<Electron.SaveDialogReturnValue>
    >(),
}));

vi.mock("electron", () => ({
  dialog: {
    showMessageBox: state.messageBox,
    showSaveDialog: state.saveDialog,
  },
}));

describe("database recovery key export", () => {
  let temporaryDirectory = "";

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "kisa-database-key-export-")
    );
    state.messageBox.mockReset();
    state.saveDialog.mockReset();
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { force: true, recursive: true });
  });

  it("stops before choosing a destination when the warning is cancelled", async () => {
    state.messageBox.mockResolvedValue({ checkboxChecked: false, response: 1 });

    await expect(
      Effect.runPromise(exportDatabaseRecoveryKey(Buffer.alloc(32, 7), false))
    ).resolves.toBe("cancelled");
    expect(state.saveDialog).not.toHaveBeenCalled();
  });

  it("writes a versioned portable key file", async () => {
    const destination = path.join(temporaryDirectory, "recovery.kisa-key");
    const key = Buffer.alloc(32, 7);
    state.messageBox.mockResolvedValue({ checkboxChecked: false, response: 0 });
    state.saveDialog.mockResolvedValue({
      canceled: false,
      filePath: destination,
    });

    await expect(
      Effect.runPromise(exportDatabaseRecoveryKey(key, true))
    ).resolves.toBe("saved");

    const document = JSON.parse(await readFile(destination, "utf-8"));
    expect(document).toStrictEqual({
      format: "kisa-database-recovery-key",
      key: key.toString("base64"),
      version: 1,
    });
    expect(state.saveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "Kisa Development Database Recovery Key.kisa-key",
      })
    );
  });

  it.runIf(process.platform !== "win32")(
    "writes the recovery key with owner-only permissions",
    async () => {
      const destination = path.join(temporaryDirectory, "recovery.kisa-key");
      state.messageBox.mockResolvedValue({
        checkboxChecked: false,
        response: 0,
      });
      state.saveDialog.mockResolvedValue({
        canceled: false,
        filePath: destination,
      });

      await expect(
        Effect.runPromise(exportDatabaseRecoveryKey(Buffer.alloc(32, 7), false))
      ).resolves.toBe("saved");

      const destinationStat = await stat(destination);
      expect(destinationStat.mode % 0o1000).toBe(0o600);
    }
  );

  it("rejects keys that do not match the database key size", () => {
    expect(() => encodeDatabaseRecoveryKeyFile(Buffer.alloc(31))).toThrow(
      "Database recovery key is invalid"
    );
  });

  it("decodes a valid exported key and rejects another file format", () => {
    const key = Buffer.alloc(32, 9);
    const encoded = encodeDatabaseRecoveryKeyFile(key);

    expect(
      decodeDatabaseRecoveryKeyFile(Buffer.from(encoded).toString())
    ).toStrictEqual(key);
    expect(() =>
      decodeDatabaseRecoveryKeyFile('{"format":"something-else"}')
    ).toThrow("Database recovery key is invalid");
  });
});
