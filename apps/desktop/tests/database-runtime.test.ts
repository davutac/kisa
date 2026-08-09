// Oxlint does not recognize @effect/vitest's it.effect as a test declaration.
// oxlint-disable vitest/no-standalone-expect sonarjs/no-empty-test-file
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import type {
  DatabaseClient,
  DatabaseConnection,
} from "../../../packages/database/src/client";
import { createDatabaseRuntime } from "../../../packages/database/src/runtime";

const createConnection = (close: () => void): DatabaseConnection =>
  ({ close }) as DatabaseConnection;

describe(createDatabaseRuntime, () => {
  it.effect("starts once and returns the migrated client", () =>
    Effect.gen(function* startsRuntime() {
      let directoryPath = "";
      let migratedClient: DatabaseClient | null = null;
      let migrationsFolder = "";
      let openCount = 0;
      let migrateCount = 0;
      const client = {} as DatabaseClient;
      const connection = createConnection(() => {});
      const runtime = createDatabaseRuntime(
        {
          databasePath: "/app-data/example/app.sqlite",
          migrationsFolder: "/app-data/example/drizzle",
        },
        {
          applyMigrations: (database, nextMigrationsFolder) => {
            migrateCount += 1;
            migratedClient = database;
            migrationsFolder = nextMigrationsFolder;
          },
          createClient: () => client,
          createDirectory: (nextDirectoryPath) => {
            directoryPath = nextDirectoryPath;
          },
          openConnection: () => {
            openCount += 1;
            return connection;
          },
        }
      );

      yield* runtime.start;
      yield* runtime.start;
      const databaseClient = yield* runtime.getClient;
      const databaseConnection = yield* runtime.getConnection;

      expect({
        databaseClient,
        databaseConnection,
        directoryPath,
        migrateCount,
        migratedClient,
        migrationsFolder,
        openCount,
      }).toStrictEqual({
        databaseClient: client,
        databaseConnection: connection,
        directoryPath: "/app-data/example",
        migrateCount: 1,
        migratedClient: client,
        migrationsFolder: "/app-data/example/drizzle",
        openCount: 1,
      });
    })
  );

  it.effect("closes the opened connection when migration fails", () =>
    Effect.gen(function* handlesMigrationFailure() {
      let didClose = false;
      const runtime = createDatabaseRuntime(
        {
          databasePath: "/app-data/example/app.sqlite",
          migrationsFolder: "/app-data/example/drizzle",
        },
        {
          applyMigrations: () => {
            throw new Error("bad migration");
          },
          createClient: () => ({}) as DatabaseClient,
          createDirectory: () => {},
          openConnection: () =>
            createConnection(() => {
              didClose = true;
            }),
        }
      );

      const startExit = yield* Effect.exit(runtime.start);
      const clientExit = yield* Effect.exit(runtime.getClient);

      expect({
        clientFailed: Exit.isFailure(clientExit),
        didClose,
        startFailed: Exit.isFailure(startExit),
      }).toStrictEqual({
        clientFailed: true,
        didClose: true,
        startFailed: true,
      });
    })
  );

  it.effect("closes the opened connection when client creation fails", () =>
    Effect.gen(function* handlesClientCreationFailure() {
      let didClose = false;
      const runtime = createDatabaseRuntime(
        {
          databasePath: "/app-data/example/app.sqlite",
          migrationsFolder: "/app-data/example/drizzle",
        },
        {
          applyMigrations: () => {},
          createClient: () => {
            throw new Error("bad client");
          },
          createDirectory: () => {},
          openConnection: () =>
            createConnection(() => {
              didClose = true;
            }),
        }
      );

      const startExit = yield* Effect.exit(runtime.start);

      expect({
        didClose,
        startFailed: Exit.isFailure(startExit),
      }).toStrictEqual({
        didClose: true,
        startFailed: true,
      });
    })
  );
});
