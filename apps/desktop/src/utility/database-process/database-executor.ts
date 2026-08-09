import type { DatabaseConnection } from "@repo/database/client";
import { createDatabaseRuntime } from "@repo/database/runtime";
import type {
  DatabaseError,
  DatabaseRuntimePaths,
} from "@repo/database/runtime";
import { Context, Effect, Layer } from "effect";

import type {
  DatabaseExecutePayload,
  DatabaseExecuteResult,
  DatabaseRow,
} from "../../shared/database-rpc";
import { DatabaseQueryError } from "../../shared/database-rpc";

export class DatabaseExecutor extends Context.Service<
  DatabaseExecutor,
  {
    readonly execute: (
      payload: DatabaseExecutePayload
    ) => Effect.Effect<DatabaseExecuteResult, DatabaseQueryError>;
  }
>()("kisa/utility/database-process/DatabaseExecutor") {}

const causeMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export const makeDatabaseExecutor = (
  connection: DatabaseConnection
): DatabaseExecutor["Service"] =>
  DatabaseExecutor.of({
    execute: Effect.fn("DatabaseExecutor.execute")(
      function* executeDatabase(payload) {
        return yield* Effect.try({
          catch: (cause) =>
            new DatabaseQueryError({ message: causeMessage(cause) }),
          try: (): DatabaseExecuteResult => {
            const statement = connection.prepare(payload.sql);

            if (payload.method === "run") {
              statement.run(...payload.params);
              return [];
            }
            const rawStatement = statement.raw(true);
            if (payload.method === "get") {
              return rawStatement.get(...payload.params) as
                | DatabaseRow
                | undefined;
            }
            return rawStatement.all(...payload.params) as DatabaseRow[];
          },
        });
      }
    ),
  });

export const layerDatabaseExecutor = (
  paths: DatabaseRuntimePaths
): Layer.Layer<DatabaseExecutor, DatabaseError> =>
  Layer.effect(
    DatabaseExecutor,
    Effect.gen(function* makeExecutor() {
      const runtime = createDatabaseRuntime(paths);
      yield* Effect.acquireRelease(runtime.start, () =>
        Effect.sync(runtime.close)
      );
      const connection = yield* runtime.getConnection;
      return makeDatabaseExecutor(connection);
    })
  );
