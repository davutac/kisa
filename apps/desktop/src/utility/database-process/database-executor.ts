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

/**
 * Prepared statements kept by their SQL. Drizzle sends the same text for the
 * same query shape, so most are prepared once rather than on every call. A
 * multi-row write's text varies with its row count, so the cache is bounded,
 * dropping the statement used longest ago.
 */
export const STATEMENT_CACHE_SIZE = 200;

const makeStatementCache = (connection: DatabaseConnection) => {
  const prepareStatement = (sql: string) => connection.prepare<unknown[]>(sql);
  const statements = new Map<string, ReturnType<typeof prepareStatement>>();

  return (sql: string) => {
    const cached = statements.get(sql);

    if (cached !== undefined) {
      // Map keeps insertion order; moving the entry last marks it recent.
      statements.delete(sql);
      statements.set(sql, cached);

      return cached;
    }

    const statement = prepareStatement(sql);
    statements.set(sql, statement);

    if (statements.size > STATEMENT_CACHE_SIZE) {
      const [oldest] = statements.keys();

      if (oldest !== undefined) {
        statements.delete(oldest);
      }
    }

    return statement;
  };
};

export const makeDatabaseExecutor = (
  connection: DatabaseConnection
): DatabaseExecutor["Service"] => {
  const prepare = makeStatementCache(connection);

  return DatabaseExecutor.of({
    execute: Effect.fn("DatabaseExecutor.execute")(
      function* executeDatabase(payload) {
        return yield* Effect.try({
          catch: (cause) =>
            new DatabaseQueryError({ message: causeMessage(cause) }),
          try: (): DatabaseExecuteResult => {
            const statement = prepare(payload.sql);

            if (payload.method === "run") {
              statement.run(...payload.params);

              return [];
            }

            const rawStatement = statement.raw(true);

            // SAFETY: `raw(true)` makes `all` return each row as the array of
            // its column values, which is what a DatabaseRow is.
            return rawStatement.all(...payload.params) as DatabaseRow[];
          },
        });
      }
    ),
  });
};

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
