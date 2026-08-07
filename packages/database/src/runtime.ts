import { mkdirSync } from "node:fs";
import path from "node:path";

import { Effect, Schema } from "effect";

import {
  applyDatabaseMigrations,
  createDatabaseClient,
  openDatabaseConnection,
} from "./client";
import type { DatabaseClient, DatabaseConnection } from "./client";

export type DatabaseErrorReason =
  | "create-directory"
  | "migrate"
  | "not-ready"
  | "open";

const formatErrorCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

// oxlint-disable-next-line unicorn/throw-new-error
export class DatabaseError extends Schema.TaggedErrorClass<DatabaseError>()(
  "DatabaseError",
  {
    cause: Schema.optional(Schema.Defect()),
    causeMessage: Schema.optional(Schema.String),
    message: Schema.String,
    reason: Schema.Literals([
      "create-directory",
      "migrate",
      "not-ready",
      "open",
    ]),
  }
) {
  constructor(args: { cause?: unknown; reason: DatabaseErrorReason }) {
    if (args.reason === "not-ready") {
      super({ message: "Database is not ready", reason: args.reason });
      return;
    }

    const causeMessage = formatErrorCause(args.cause);
    super({
      cause: args.cause,
      causeMessage,
      message: `Database startup failed during ${args.reason}: ${causeMessage}`,
      reason: args.reason,
    });
  }
}

export { DatabaseError as DatabaseRuntimeError };

export type DatabaseRuntimeEffect<T> = Effect.Effect<T, DatabaseError>;

export interface DatabaseRuntimePaths {
  databasePath: string;
  migrationsFolder: string;
}

export interface DatabaseRuntimeAdapters {
  applyMigrations?: (
    database: DatabaseClient,
    migrationsFolder: string
  ) => void;
  createClient?: (connection: DatabaseConnection) => DatabaseClient;
  createDirectory?: (directoryPath: string) => void;
  openConnection?: (databasePath: string) => DatabaseConnection;
}

export interface DatabaseRuntime {
  close: () => void;
  getClient: () => DatabaseRuntimeEffect<DatabaseClient>;
  start: () => DatabaseRuntimeEffect<void>;
}

export const createDatabaseRuntime = (
  paths: DatabaseRuntimePaths,
  adapters: DatabaseRuntimeAdapters = {}
): DatabaseRuntime => {
  const createDirectory =
    adapters.createDirectory ??
    ((directoryPath: string): void => {
      mkdirSync(directoryPath, { recursive: true });
    });
  const openConnection = adapters.openConnection ?? openDatabaseConnection;
  const createClient = adapters.createClient ?? createDatabaseClient;
  const applyMigrations = adapters.applyMigrations ?? applyDatabaseMigrations;

  let databaseConnection: DatabaseConnection | null = null;
  let databaseClient: DatabaseClient | null = null;

  const closeCurrentConnection = (): void => {
    databaseClient = null;

    if (databaseConnection === null) {
      return;
    }

    databaseConnection.close();
    databaseConnection = null;
  };

  return {
    close: closeCurrentConnection,
    getClient: Effect.fn("DatabaseRuntime.getClient")(
      function* getClientEffect() {
        if (databaseClient === null) {
          return yield* new DatabaseError({ reason: "not-ready" });
        }

        return databaseClient;
      }
    ),
    start: Effect.fn("DatabaseRuntime.start")(function* startEffect() {
      if (databaseClient !== null) {
        return;
      }

      yield* Effect.try({
        catch: (cause) =>
          new DatabaseError({ cause, reason: "create-directory" }),
        try: () => createDirectory(path.dirname(paths.databasePath)),
      });
      const connection = yield* Effect.try({
        catch: (cause) => new DatabaseError({ cause, reason: "open" }),
        try: () => openConnection(paths.databasePath),
      });
      const client = yield* Effect.try({
        catch: (cause) => new DatabaseError({ cause, reason: "open" }),
        try: () => createClient(connection),
      }).pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            connection.close();
          })
        )
      );

      yield* Effect.try({
        catch: (cause) => new DatabaseError({ cause, reason: "migrate" }),
        try: () => applyMigrations(client, paths.migrationsFolder),
      }).pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            connection.close();
          })
        )
      );

      databaseConnection = connection;
      databaseClient = client;
    }),
  };
};
