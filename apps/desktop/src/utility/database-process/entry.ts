import { Cause, Effect, Layer, Predicate, Schema } from "effect";
import * as RpcServer from "effect/rpc/RpcServer";

import { DatabaseRpcs } from "../../shared/database-rpc";
import { DatabaseUnlock } from "../../shared/database-unlock";
import { DatabaseExecutor, layerDatabaseExecutor } from "./database-executor";
import * as ElectronUtilityRunner from "./electron-utility-runner";

const DatabasePaths = Schema.Tuple([Schema.String, Schema.String]);

// oxlint-disable-next-line unicorn/throw-new-error
class DatabaseUnlockError extends Schema.TaggedError<
  DatabaseUnlockError,
  { readonly brand: unique symbol }
>()("DatabaseUnlockError", { message: Schema.String }) {}

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

  // The program ends when main asks the server to close, or when it cannot
  // start, after its finalizers have closed SQLite. Electron keeps a utility
  // process alive while its parent port is open, so without this main waits
  // out its whole close timeout on every quit and then kills the process.
  // Only a utility process has that port; anywhere else, nothing lingers.
  if (Predicate.isNotNullish(Reflect.get(process, "parentPort"))) {
    process.exit();
  }
};

void main();
