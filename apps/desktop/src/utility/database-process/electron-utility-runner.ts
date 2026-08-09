// Electron's parentPort postMessage is not the DOM API, and Effect prescribes
// the callback signature.
// oxlint-disable typescript/no-invalid-void-type unicorn/require-post-message-target-origin
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect";
import {
  WorkerError,
  WorkerReceiveError,
  WorkerSpawnError,
} from "effect/unstable/workers/WorkerError";
import * as WorkerRunner from "effect/unstable/workers/WorkerRunner";

export const layer: Layer.Layer<WorkerRunner.WorkerRunnerPlatform> =
  Layer.succeed(WorkerRunner.WorkerRunnerPlatform, {
    start<O = unknown, I = unknown>() {
      return Effect.gen(function* startUtilityRunner() {
        const { parentPort } = process;
        if (parentPort === null) {
          return yield* new WorkerError({
            reason: new WorkerSpawnError({
              message: "Database process has no Electron parent port",
            }),
          });
        }

        const sendUnsafe = (
          _portId: number,
          message: O,
          _transfers?: readonly unknown[]
        ): void => parentPort.postMessage([1, message]);
        const send = (
          portId: number,
          message: O,
          transfers?: readonly unknown[]
        ) => Effect.sync(() => sendUnsafe(portId, message, transfers));

        const run = <A, E, R>(
          handler: (portId: number, message: I) => Effect.Effect<A, E, R> | void
        ): Effect.Effect<void, WorkerError, R> =>
          Effect.scopedWith(
            Effect.fnUntraced(function* runUtilityMessages(scope) {
              const closed = Deferred.makeUnsafe<void, WorkerError>();
              const trackFiber = Fiber.runIn(scope);
              const services = yield* Effect.context<R>();
              const runFork = Effect.runForkWith(services);

              const onMessage = (event: Electron.MessageEvent): void => {
                const message = event.data as WorkerRunner.PlatformMessage<I>;
                if (message[0] === 0) {
                  const result = handler(0, message[1]);
                  if (Effect.isEffect(result)) {
                    const fiber = runFork(result);
                    fiber.addObserver((exit: Exit.Exit<A, E>) => {
                      if (
                        exit._tag === "Failure" &&
                        !Cause.hasInterruptsOnly(exit.cause)
                      ) {
                        runFork(
                          Effect.logError(
                            "Unhandled database utility process error",
                            exit.cause
                          )
                        );
                      }
                    });
                    trackFiber(fiber);
                  }
                  return;
                }

                Deferred.doneUnsafe(closed, Exit.void);
              };

              parentPort.on("message", onMessage);
              yield* Scope.addFinalizer(
                scope,
                Effect.sync(() => {
                  parentPort.removeListener("message", onMessage);
                })
              );

              parentPort.postMessage([0]);
              return yield* Deferred.await(closed);
            })
          ).pipe(
            Effect.mapError(
              (cause) =>
                new WorkerError({
                  reason: new WorkerReceiveError({
                    cause,
                    message: "Database utility process runner failed",
                  }),
                })
            )
          );

        return { run, send, sendUnsafe };
      });
    },
  });
