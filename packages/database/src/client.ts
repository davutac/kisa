import { closeSync, openSync, readSync } from "node:fs";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { databaseRelations } from "./relations";

export type DatabaseConnection = Database.Database;
export type DatabaseClient = BetterSQLite3Database<typeof databaseRelations>;

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "utf-8");
const CHACHA20_KDF_ITERATIONS = 64_007;

const callCipherMethod = (
  connection: DatabaseConnection,
  methodName: "key" | "rekey",
  encryptionKey: Buffer
): void => {
  const method: unknown = Reflect.get(connection, methodName);
  if (typeof method !== "function") {
    throw new TypeError("SQLite cipher support is unavailable");
  }

  Reflect.apply(method, connection, [encryptionKey]);
};

const hasPlaintextHeader = (databasePath: string): boolean => {
  if (databasePath === ":memory:") {
    return false;
  }

  let file: number;
  try {
    file = openSync(databasePath, "r");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }

  try {
    const header = Buffer.alloc(SQLITE_HEADER.byteLength);
    const bytesRead = readSync(file, header, 0, header.byteLength, 0);
    return (
      bytesRead === SQLITE_HEADER.byteLength && header.equals(SQLITE_HEADER)
    );
  } finally {
    closeSync(file);
  }
};

const configureCipher = (connection: DatabaseConnection): void => {
  connection.pragma("cipher = 'chacha20'");
  connection.pragma("legacy = 0");
  connection.pragma(`kdf_iter = ${CHACHA20_KDF_ITERATIONS}`);
  connection.pragma("plaintext_header_size = 0");
};

const configureWalConnection = (connection: DatabaseConnection): void => {
  connection.pragma("journal_mode = WAL");
  connection.pragma("synchronous = NORMAL");
  connection.pragma("busy_timeout = 5000");
};

const configureEncryptedConnection = (
  connection: DatabaseConnection,
  encryptionKey: Buffer
): void => {
  configureCipher(connection);
  callCipherMethod(connection, "key", encryptionKey);
  connection.prepare("SELECT count(*) FROM sqlite_master").get();
};

const encryptPlaintextDatabase = (
  databasePath: string,
  encryptionKey: Buffer
): void => {
  const connection = new Database(databasePath);

  try {
    connection.pragma("wal_checkpoint(TRUNCATE)");
    connection.pragma("journal_mode = DELETE");
    configureCipher(connection);
    callCipherMethod(connection, "rekey", encryptionKey);
  } finally {
    connection.close();
  }
};

/**
 * WAL is what lets the mail indexer write while the UI reads: the default
 * rollback journal takes an exclusive lock for the duration of a write, so a
 * sustained backfill would stall every list query behind it. `NORMAL`
 * synchronous is WAL's usual companion — durable across an app crash, and only
 * the last transactions are at risk on power loss, which is the right trade for
 * a cache that can be refetched. `busy_timeout` covers the brief overlap
 * between the poll sync and the indexer rather than surfacing SQLITE_BUSY.
 */
export const openDatabaseConnection = (
  databasePath: string
): DatabaseConnection => {
  const connection = new Database(databasePath);

  configureWalConnection(connection);

  return connection;
};

export const openEncryptedDatabaseConnection = (
  databasePath: string,
  encryptionKey: Uint8Array
): DatabaseConnection => {
  if (encryptionKey.byteLength !== 32) {
    throw new Error("Database encryption key must be 32 bytes");
  }

  const key = Buffer.from(encryptionKey);

  try {
    if (hasPlaintextHeader(databasePath)) {
      encryptPlaintextDatabase(databasePath, key);
    }

    const connection = new Database(databasePath);

    try {
      configureEncryptedConnection(connection, key);
      configureWalConnection(connection);
      return connection;
    } catch (error) {
      connection.close();
      throw error;
    }
  } finally {
    key.fill(0);
  }
};

export const createDatabaseClient = (
  database: DatabaseConnection
): DatabaseClient =>
  drizzle({ client: database, relations: databaseRelations });

export const applyDatabaseMigrations = (
  database: DatabaseClient,
  migrationsFolder: string
): void => {
  migrate(database, { migrationsFolder });
};
