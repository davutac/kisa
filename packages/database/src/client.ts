import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { accountSettings } from "./schemas/account-settings";
import { gmailLabels } from "./schemas/gmail-labels";
import { gmailSenderBrands } from "./schemas/gmail-sender-brands";
import { gmailSyncState } from "./schemas/gmail-sync-state";
import { gmailThreads } from "./schemas/gmail-threads";
import { gmailTrustedImageSenders } from "./schemas/gmail-trusted-image-senders";
import { googleAccounts } from "./schemas/google-accounts";
import { test } from "./schemas/test";

const schema = {
  accountSettings,
  gmailLabels,
  gmailSenderBrands,
  gmailSyncState,
  gmailThreads,
  gmailTrustedImageSenders,
  googleAccounts,
  test,
};

export type DatabaseConnection = Database.Database;
export type DatabaseClient = BetterSQLite3Database<typeof schema>;

export const openDatabaseConnection = (
  databasePath: string
): DatabaseConnection => new Database(databasePath);

export const createDatabaseClient = (
  database: DatabaseConnection
): DatabaseClient => drizzle(database, { casing: "snake_case", schema });

export const applyDatabaseMigrations = (
  database: DatabaseClient,
  migrationsFolder: string
): void => {
  migrate(database, { migrationsFolder });
};
