import path from "node:path";

import { createDatabaseRuntime } from "@repo/database/runtime";
import type { DatabaseRuntime } from "@repo/database/runtime";
import { Effect } from "effect";
import { app } from "electron";

export { DatabaseError } from "@repo/database/runtime";

const getDatabasePath = (): string =>
  path.join(app.getPath("userData"), "database", "app.sqlite");

const getMigrationsFolder = (): string => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "database", "drizzle");
  }

  return path.join(
    app.getAppPath(),
    "..",
    "..",
    "packages",
    "database",
    "drizzle"
  );
};

let databaseRuntime: DatabaseRuntime | null = null;

const getDatabaseRuntime = (): DatabaseRuntime => {
  databaseRuntime ??= createDatabaseRuntime({
    databasePath: getDatabasePath(),
    migrationsFolder: getMigrationsFolder(),
  });

  return databaseRuntime;
};

export const startDatabase = Effect.fn("startDatabase")(() =>
  getDatabaseRuntime().start()
);

export const getDatabaseClient = Effect.fn("getDatabaseClient")(() =>
  getDatabaseRuntime().getClient()
);

export const closeDatabase = (): void => {
  databaseRuntime?.close();
  databaseRuntime = null;
};
