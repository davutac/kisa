import { Cause, Effect, Layer, Schema } from "effect";
import * as RpcServer from "effect/unstable/rpc/RpcServer";

import { DatabaseRpcs } from "../../shared/database-rpc";
import { DatabaseUnlock } from "../../shared/database-unlock";
import { DatabaseExecutor, layerDatabaseExecutor } from "./database-executor";
import * as ElectronUtilityRunner from "./electron-utility-runner";

const DatabasePaths = Schema.Tuple([Schema.String, Schema.String]);

// oxlint-disable-next-line unicorn/throw-new-error
class DatabaseUnlockError extends Schema.TaggedError<DatabaseUnlockError>()(
  "DatabaseUnlockError",
  { message: Schema.String }
) {}

const receiveDatabaseKey = Effect.fn("receiveDatabaseKey")(
  function* receiveDatabaseKeyEffect() {
    const { parentPort } = process;
    if (parentPort === null) {
      return yield* new DatabaseUnlockError({
        message: "Database process has no Electron parent port",
      });
    }

    const message = yield* Effect.callback<unknown, DatabaseUnlockError>(
      (resume) => {
        const onMessage = (event: Electron.MessageEvent): void => {
          resume(Effect.succeed(event.data));
        };

        parentPort.once("message", onMessage);
        return Effect.sync(() => {
          parentPort.removeListener("message", onMessage);
        });
      }
    );
    const unlock = yield* Schema.decodeUnknownEffect(DatabaseUnlock)(
      message
    ).pipe(
      Effect.mapError(
        () =>
          new DatabaseUnlockError({
            message: "Database process received an invalid unlock message",
          })
      )
    );

    if (unlock.key.byteLength !== 32) {
      return yield* new DatabaseUnlockError({
        message: "Database process received an invalid key",
      });
    }

    return Buffer.from(unlock.key);
  }
);

const program = Effect.gen(function* databaseProcessProgram() {
  const [databasePath, migrationsFolder] = yield* Schema.decodeUnknownEffect(
    DatabasePaths
  )(process.argv.slice(-2));
  const encryptionKey = yield* receiveDatabaseKey();

  const handlers = DatabaseRpcs.toLayer(
    Effect.gen(function* makeHandlers() {
      const executor = yield* DatabaseExecutor;
      return DatabaseRpcs.of({
        DatabaseReady: () => Effect.void,
        ExecuteDatabase: executor.execute,
      });
    })
  ).pipe(
    Layer.provide(
      layerDatabaseExecutor({ databasePath, encryptionKey, migrationsFolder })
    )
  );

  const server = RpcServer.layer(DatabaseRpcs).pipe(
    Layer.provide(handlers),
    Layer.provide(RpcServer.layerProtocolWorkerRunner),
    Layer.provide(ElectronUtilityRunner.layer)
  );

  return yield* Layer.launch(server);
});

const main = async (): Promise<void> => {
  const exit = await Effect.runPromiseExit(program);

  if (exit._tag === "Failure" && !Cause.hasInterruptsOnly(exit.cause)) {
    console.error("Database utility process failed", Cause.squash(exit.cause));
    process.exitCode = 1;
  }
};

void main();
