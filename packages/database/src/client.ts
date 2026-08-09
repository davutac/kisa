import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { databaseRelations } from "./relations";

export type DatabaseConnection = Database.Database;
export type DatabaseClient = BetterSQLite3Database<typeof databaseRelations>;

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

  connection.pragma("journal_mode = WAL");
  connection.pragma("synchronous = NORMAL");
  connection.pragma("busy_timeout = 5000");

  return connection;
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
