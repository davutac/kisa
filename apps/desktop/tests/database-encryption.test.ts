import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  openDatabaseConnection,
  openEncryptedDatabaseConnection,
} from "../../../packages/database/src/client";

const temporaryDirectories: string[] = [];

const makeDatabasePath = (): string => {
  const directory = mkdtempSync(path.join(tmpdir(), "kisa-encryption-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "app.sqlite");
};

const readHeader = (databasePath: string): string =>
  readFileSync(databasePath).subarray(0, 16).toString("utf-8");

describe(openEncryptedDatabaseConnection, () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("creates and reopens an encrypted database", () => {
    const databasePath = makeDatabasePath();
    const key = Buffer.alloc(32, 1);
    const created = openEncryptedDatabaseConnection(databasePath, key);
    created.exec("CREATE TABLE examples (value TEXT)");
    created.prepare("INSERT INTO examples VALUES (?)").run("Kisa");
    created.close();

    expect(readHeader(databasePath)).not.toBe("SQLite format 3\0");

    const reopened = openEncryptedDatabaseConnection(databasePath, key);
    try {
      expect(
        reopened.prepare("SELECT value FROM examples").get()
      ).toStrictEqual({ value: "Kisa" });
    } finally {
      reopened.close();
    }
  });

  it("migrates an existing plaintext WAL database with rekey", () => {
    const databasePath = makeDatabasePath();
    const plaintext = openDatabaseConnection(databasePath);
    plaintext.exec("CREATE TABLE examples (value TEXT)");
    plaintext.prepare("INSERT INTO examples VALUES (?)").run("migrated");
    plaintext.close();

    expect(readHeader(databasePath)).toBe("SQLite format 3\0");

    const encrypted = openEncryptedDatabaseConnection(
      databasePath,
      Buffer.alloc(32, 2)
    );
    try {
      expect(
        encrypted.prepare("SELECT value FROM examples").get()
      ).toStrictEqual({ value: "migrated" });
    } finally {
      encrypted.close();
    }

    expect(readHeader(databasePath)).not.toBe("SQLite format 3\0");
  });

  it("rejects a wrong key without changing the database", () => {
    const databasePath = makeDatabasePath();
    const created = openEncryptedDatabaseConnection(
      databasePath,
      Buffer.alloc(32, 3)
    );
    created.exec("CREATE TABLE examples (value TEXT)");
    created.close();

    expect(() =>
      openEncryptedDatabaseConnection(databasePath, Buffer.alloc(32, 4))
    ).toThrow(/database/u);

    const reopened = openEncryptedDatabaseConnection(
      databasePath,
      Buffer.alloc(32, 3)
    );
    reopened.close();
  });
});
