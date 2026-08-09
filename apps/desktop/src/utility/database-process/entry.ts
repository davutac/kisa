import { Cause, Effect, Layer, Schema } from "effect";
import * as RpcServer from "effect/unstable/rpc/RpcServer";

import { DatabaseRpcs } from "../../shared/database-rpc";
import { DatabaseExecutor, layerDatabaseExecutor } from "./database-executor";
import * as ElectronUtilityRunner from "./electron-utility-runner";

const DatabasePaths = Schema.Tuple([Schema.String, Schema.String]);

const program = Effect.gen(function* databaseProcessProgram() {
  const [databasePath, migrationsFolder] = yield* Schema.decodeUnknownEffect(
    DatabasePaths
  )(process.argv.slice(-2));

  const handlers = DatabaseRpcs.toLayer(
    Effect.gen(function* makeHandlers() {
      const executor = yield* DatabaseExecutor;
      return DatabaseRpcs.of({
        DatabaseReady: () => Effect.void,
        ExecuteDatabase: executor.execute,
      });
    })
  ).pipe(
    Layer.provide(layerDatabaseExecutor({ databasePath, migrationsFolder }))
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
