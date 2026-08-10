import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DatabaseKeyProtector } from "../src/main/database-key";
import { loadOrCreateDatabaseKey } from "../src/main/database-key";

const temporaryDirectories: string[] = [];

const makeProtector = (): DatabaseKeyProtector => ({
  decrypt: (encrypted) =>
    Promise.resolve(encrypted.toString("utf-8").replace(/^sealed:/u, "")),
  encrypt: (plaintext) =>
    Promise.resolve(Buffer.from(`sealed:${plaintext}`, "utf-8")),
});

const makeKeyPath = (): string => {
  const directory = mkdtempSync(path.join(tmpdir(), "kisa-database-key-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "app.sqlite.key");
};

describe(loadOrCreateDatabaseKey, () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("creates and reopens the same 256-bit key", async () => {
    const keyPath = makeKeyPath();
    const protector = makeProtector();

    const created = await loadOrCreateDatabaseKey(keyPath, protector);
    const reopened = await loadOrCreateDatabaseKey(keyPath, protector);

    expect(created).toHaveLength(32);
    expect(reopened).toStrictEqual(created);
  });

  it("does not replace an unreadable saved key", async () => {
    const keyPath = makeKeyPath();
    const protector = makeProtector();
    await loadOrCreateDatabaseKey(keyPath, protector);

    await expect(
      loadOrCreateDatabaseKey(keyPath, {
        ...protector,
        decrypt: () => Promise.resolve("invalid"),
      })
    ).rejects.toThrow("Database key is invalid");

    await expect(
      loadOrCreateDatabaseKey(keyPath, protector)
    ).resolves.toHaveLength(32);
  });
});
