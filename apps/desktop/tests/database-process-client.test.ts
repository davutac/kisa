// Oxlint does not recognize @effect/vitest's it.effect as a test declaration.
// oxlint-disable vitest/no-standalone-expect sonarjs/no-empty-test-file
import { describe, expect, it } from "@effect/vitest";
import { openDatabaseConnection } from "@repo/database/client";
import { sql } from "drizzle-orm";
import { Deferred, Effect, Fiber, Schema } from "effect";

import { createDatabaseProcessClient } from "../src/main/database-process/client";
import {
  DatabaseExecutePayload,
  DatabaseExecuteResult,
} from "../src/shared/database-rpc";
import { makeDatabaseExecutor } from "../src/utility/database-process/database-executor";

describe(createDatabaseProcessClient, () => {
  it.effect("executes remote Drizzle queries against the database owner", () =>
    Effect.scoped(
      Effect.gen(function* executesQueries() {
        const connection = yield* Effect.acquireRelease(
          Effect.sync(() => openDatabaseConnection(":memory:")),
          (databaseConnection) => Effect.sync(() => databaseConnection.close())
        );
        const executor = makeDatabaseExecutor(connection);
        const payloadCodec = Schema.toCodecJson(DatabaseExecutePayload);
        const resultCodec = Schema.toCodecJson(DatabaseExecuteResult);
        const client = createDatabaseProcessClient((payload) =>
          Effect.gen(function* crossesRpcCodec() {
            const encodedPayload =
              yield* Schema.encodeEffect(payloadCodec)(payload);
            const decodedPayload = yield* Schema.decodeEffect(payloadCodec)(
              structuredClone(encodedPayload)
            );
            const result = yield* executor.execute(decodedPayload);
            const encodedResult =
              yield* Schema.encodeEffect(resultCodec)(result);
            return yield* Schema.decodeEffect(resultCodec)(
              structuredClone(encodedResult)
            );
          })
        );

        const rows = yield* client.use((database) =>
          Effect.tryPromise(async () => {
            await database.run(
              sql.raw(
                "CREATE TABLE examples (id INTEGER, name TEXT, data BLOB)"
              )
            );
            await database.run(
              sql`INSERT INTO examples VALUES (1, ${"Kisa"}, ${Buffer.from([1, 2, 3])})`
            );

            return database.values<[number, string, Buffer]>(
              sql`SELECT id, name, data FROM examples`
            );
          })
        );

        expect(rows).toStrictEqual([[1, "Kisa", Buffer.from([1, 2, 3])]]);
      })
    )
  );

  it.effect("serializes complete logical database operations", () =>
    Effect.gen(function* serializesOperations() {
      const entered = yield* Deferred.make<null>();
      const release = yield* Deferred.make<null>();
      let secondEntered = false;
      const client = createDatabaseProcessClient(() => Effect.succeed([]));

      const first = yield* client
        .use(() =>
          Deferred.succeed(entered, null).pipe(
            Effect.andThen(Deferred.await(release))
          )
        )
        .pipe(Effect.forkChild);

      yield* Deferred.await(entered);
      const second = yield* client
        .use(() =>
          Effect.sync(() => {
            secondEntered = true;
          })
        )
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      expect(secondEntered).toBeFalsy();

      yield* Deferred.succeed(release, null);
      yield* Fiber.join(first);
      yield* Fiber.join(second);

      expect(secondEntered).toBeTruthy();
    })
  );
});
