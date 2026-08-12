// Mirrors Effect's Node worker adapter; Electron's UtilityProcess postMessage
// is not the DOM API and the protocol callback shape is prescribed by Effect.
// oxlint-disable eslint/sort-keys typescript/no-invalid-void-type unicorn/require-post-message-target-origin
import { Deferred, Effect, Exit, Layer, Scope } from "effect";
import * as Worker from "effect/unstable/workers/Worker";
import {
  WorkerError,
  WorkerReceiveError,
} from "effect/unstable/workers/WorkerError";
import type { UtilityProcess } from "electron";

const layerPlatform: Layer.Layer<Worker.WorkerPlatform> = Layer.succeed(
  Worker.WorkerPlatform,
  Worker.makePlatform<UtilityProcess>()({
    setup({ scope, worker }) {
      const exited = Deferred.makeUnsafe<void, WorkerError>();
      worker.on("exit", () => {
        Deferred.doneUnsafe(exited, Exit.void);
      });

      return Scope.addFinalizer(
        scope,
        Effect.suspend(() => {
          worker.postMessage([1]);
          return Deferred.await(exited);
        }).pipe(
          Effect.timeout(5000),
          Effect.catchCause(() => Effect.sync(() => worker.kill()))
        )
      ).pipe(
        Effect.as({
          postMessage: <Message>(message: Message): void =>
            worker.postMessage(message),
          worker,
        })
      );
    },
    listen({ deferred, emit, port, scope }) {
      const onMessage = <Message>(message: Message): void => {
        emit(message);
      };
      const onError = (
        type: "FatalError",
        location: string,
        report: string
      ): void => {
        Deferred.doneUnsafe(
          deferred,
          new WorkerError({
            reason: new WorkerReceiveError({
              cause: { location, report, type },
              message: "Database utility process emitted an error",
            }),
          })
        );
      };
      const onExit = (code: number): void => {
        Deferred.doneUnsafe(
          deferred,
          new WorkerError({
            reason: new WorkerReceiveError({
              message: `Database utility process exited with code ${code}`,
            }),
          })
        );
      };

      port.worker.on("message", onMessage);
      port.worker.on("error", onError);
      port.worker.on("exit", onExit);

      return Scope.addFinalizer(
        scope,
        Effect.sync(() => {
          port.worker.removeListener("message", onMessage);
          port.worker.removeListener("error", onError);
          port.worker.removeListener("exit", onExit);
        })
      );
    },
  })
);

export const layer = (
  spawn: (id: number) => UtilityProcess
): Layer.Layer<Worker.WorkerPlatform | Worker.Spawner> =>
  Layer.merge(Worker.layerSpawner(spawn), layerPlatform);
