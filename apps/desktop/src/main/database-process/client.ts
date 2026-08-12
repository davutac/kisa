import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import { createRemoteDatabaseClient } from "@repo/database/remote-client";
import { Effect, Semaphore } from "effect";

import type {
  DatabaseExecutePayload,
  DatabaseExecuteResult,
  DatabaseRow,
} from "../../shared/database-rpc";

export type ExecuteDatabase = (
  payload: DatabaseExecutePayload
) => Effect.Effect<DatabaseExecuteResult, unknown>;

export interface DatabaseProcessClient {
  readonly use: <A, E, R>(
    run: (database: RemoteDatabaseClient) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>;
}

type DatabaseValue = DatabaseRow[number];

const restoreBuffer = (value: DatabaseValue): DatabaseValue => {
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  return value;
};

const restoreBuffers = (value: DatabaseExecuteResult): unknown[] => {
  if (value === undefined) {
    return [];
  }

  return value.map((entry) =>
    Array.isArray(entry) ? entry.map(restoreBuffer) : restoreBuffer(entry)
  );
};

export const createDatabaseProcessClient = (
  execute: ExecuteDatabase
): DatabaseProcessClient => {
  const semaphore = Semaphore.makeUnsafe(1);

  const use = Effect.fn("DatabaseProcessClient.use")(function* useDatabase<
    A,
    E,
    R,
  >(
    run: (database: RemoteDatabaseClient) => Effect.Effect<A, E, R>
  ): Effect.fn.Return<A, E, R> {
    const context = yield* Effect.context<R>();
    const runPromise = Effect.runPromiseWith(context);
    const database = createRemoteDatabaseClient(async (sql, params, method) => {
      const rows = await runPromise(execute({ method, params, sql }));

      return { rows: restoreBuffers(rows) };
    });

    return yield* semaphore.withPermits(1)(run(database));
  });

  return { use };
};
