import { Effect, Schema } from "effect";

const SCHEDULED_MAIL_START_RETRY_DELAYS_MS = [
  1000, 2000, 4000, 8000, 16_000, 30_000,
] as const;
const SCHEDULED_MAIL_EXHAUSTED_RETRY_DELAY_MS = 5 * 60_000;

// oxlint-disable-next-line unicorn/throw-new-error -- Effect Schema tagged errors are declared as generated classes.
class ScheduledMailLifecycleError extends Schema.TaggedError<ScheduledMailLifecycleError>()(
  "ScheduledMailLifecycleError",
  { message: Schema.String }
) {}

const lifecycleError = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Promise rejection values are unknown at this adapter boundary.
  error: unknown
): ScheduledMailLifecycleError =>
  new ScheduledMailLifecycleError({
    message:
      error instanceof Error
        ? error.message
        : "Scheduled mail startup operation failed",
  });

interface ScheduledMailLifecycleOptions {
  readonly dispatchPendingNotifications: () => Promise<void>;
  readonly exhaustedRetryDelayMs?: number;
  readonly listenForResume: (listener: () => void) => () => void;
  readonly releaseStaleNotificationClaims: () => Promise<void>;
  readonly retryDelaysMs?: readonly number[];
  readonly scheduleRetry: (
    run: () => void,
    delayMs: number
  ) => { readonly cancel: () => void };
  readonly startWorker: () => Promise<void>;
  readonly stopWorker: () => Promise<void>;
  readonly wakeWorker: () => void;
}

interface ScheduledMailLifecycle {
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
}

export const createScheduledMailLifecycle = ({
  dispatchPendingNotifications,
  exhaustedRetryDelayMs = SCHEDULED_MAIL_EXHAUSTED_RETRY_DELAY_MS,
  listenForResume,
  releaseStaleNotificationClaims,
  retryDelaysMs = SCHEDULED_MAIL_START_RETRY_DELAYS_MS,
  scheduleRetry,
  startWorker,
  stopWorker,
  wakeWorker,
}: ScheduledMailLifecycleOptions): ScheduledMailLifecycle => {
  let active = false;
  let exhaustedRetryCancellation: (() => void) | undefined;
  let generation = 0;
  let notificationClaimsReleased = false;
  let notificationsDrained = false;
  let removeResumeListener: (() => void) | undefined;
  let retryCancellation: (() => void) | undefined;
  let startPromise: Promise<void> | undefined;
  let workerStarted = false;

  const isCurrentGeneration = (candidate: number): boolean =>
    active && candidate === generation;

  const cancelExhaustedRetry = (): void => {
    exhaustedRetryCancellation?.();
    exhaustedRetryCancellation = undefined;
  };

  const waitForRetry = (
    candidate: number,
    delayMs: number
  ): Effect.Effect<boolean, ScheduledMailLifecycleError> =>
    Effect.callback<boolean, ScheduledMailLifecycleError>((resume) => {
      let settled = false;
      let retryHandle: { readonly cancel: () => void } | undefined;
      const finish = (shouldRetry: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        retryCancellation = undefined;
        resume(Effect.succeed(shouldRetry));
      };
      const cancel = (): void => {
        retryHandle?.cancel();
        finish(false);
      };

      try {
        retryHandle = scheduleRetry(
          () => finish(isCurrentGeneration(candidate)),
          delayMs
        );
        if (!settled) {
          retryCancellation = cancel;
        }
      } catch (error) {
        resume(Effect.fail(lifecycleError(error)));
      }
      return Effect.sync(cancel);
    });

  const runWithRetry = (
    candidate: number,
    operation: () => Promise<void>,
    retryIndex = 0
  ): Effect.Effect<boolean, ScheduledMailLifecycleError> => {
    if (!isCurrentGeneration(candidate)) {
      return Effect.succeed(false);
    }
    return Effect.tryPromise({ catch: lifecycleError, try: operation }).pipe(
      Effect.as({ ok: true as const }),
      // oxlint-disable-next-line promise/prefer-await-to-callbacks, promise/prefer-await-to-then -- This folds the typed Effect error channel into retry state.
      Effect.catch((error) => Effect.succeed({ error, ok: false as const })),
      Effect.flatMap((result) => {
        if (result.ok) {
          return Effect.succeed(isCurrentGeneration(candidate));
        }
        if (!isCurrentGeneration(candidate)) {
          return Effect.succeed(false);
        }
        const delayMs = retryDelaysMs[retryIndex];
        if (delayMs === undefined) {
          return Effect.fail(result.error);
        }
        return waitForRetry(candidate, delayMs).pipe(
          Effect.flatMap((shouldRetry) =>
            shouldRetry
              ? runWithRetry(candidate, operation, retryIndex + 1)
              : Effect.succeed(false)
          )
        );
      })
    );
  };

  const runGeneration = Effect.fn("ScheduledMailLifecycle.runGeneration")(
    function* runGeneration(candidate: number) {
      if (!notificationClaimsReleased) {
        if (!(yield* runWithRetry(candidate, releaseStaleNotificationClaims))) {
          return;
        }
        notificationClaimsReleased = true;
      }

      if (!workerStarted) {
        if (!(yield* runWithRetry(candidate, startWorker))) {
          return;
        }
        workerStarted = true;
      }

      if (
        !notificationsDrained &&
        (yield* runWithRetry(candidate, dispatchPendingNotifications))
      ) {
        notificationsDrained = true;
      }
    }
  );

  const scheduleExhaustedRetry = (
    candidate: number,
    retryGeneration: () => void
  ): void => {
    if (
      !isCurrentGeneration(candidate) ||
      (workerStarted && notificationsDrained) ||
      exhaustedRetryCancellation !== undefined
    ) {
      return;
    }

    let settled = false;
    let retryHandle: { readonly cancel: () => void } | undefined;
    const cancel = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      retryHandle?.cancel();
    };
    const retry = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      exhaustedRetryCancellation = undefined;
      if (isCurrentGeneration(candidate)) {
        retryGeneration();
      }
    };

    try {
      retryHandle = scheduleRetry(retry, exhaustedRetryDelayMs);
      if (!settled) {
        exhaustedRetryCancellation = cancel;
      }
    } catch {
      // The resume listener remains available if the host timer cannot arm.
    }
  };

  const beginGeneration = (): Promise<void> => {
    if (startPromise !== undefined) {
      return startPromise;
    }
    cancelExhaustedRetry();
    if (!workerStarted) {
      notificationClaimsReleased = false;
    }

    generation += 1;
    const candidate = generation;
    const pendingStart = Effect.runPromise(runGeneration(candidate));
    startPromise = pendingStart;
    const clearPendingStart = async (): Promise<void> => {
      let exhausted = false;
      try {
        await pendingStart;
      } catch {
        exhausted = true;
      }
      if (startPromise === pendingStart) {
        startPromise = undefined;
      }
      if (exhausted) {
        const retryAfterExhaustion = async (): Promise<void> => {
          try {
            await beginGeneration();
          } catch {
            // Exhaustion arms the next low-frequency generation.
          }
        };
        scheduleExhaustedRetry(candidate, () => {
          void retryAfterExhaustion();
        });
      }
    };
    void clearPendingStart();
    return pendingStart;
  };

  const retryGenerationAfterResume = async (): Promise<void> => {
    try {
      await beginGeneration();
    } catch {
      // The listener remains installed so a later resume can try again.
    }
  };

  const handleResume = (): void => {
    if (!active) {
      return;
    }
    if (workerStarted) {
      wakeWorker();
    }
    if (!workerStarted || !notificationsDrained) {
      void retryGenerationAfterResume();
    }
  };

  const start = (): Promise<void> => {
    if (!active) {
      active = true;
      removeResumeListener = listenForResume(handleResume);
    }
    if (notificationsDrained) {
      return Promise.resolve();
    }
    return beginGeneration();
  };

  const stop = async (): Promise<void> => {
    if (!active) {
      return;
    }
    active = false;
    generation += 1;
    removeResumeListener?.();
    removeResumeListener = undefined;
    retryCancellation?.();
    retryCancellation = undefined;
    cancelExhaustedRetry();

    const pendingStart = startPromise;
    await stopWorker();
    if (pendingStart !== undefined) {
      try {
        await pendingStart;
      } catch {
        // Stop owns teardown; the matching start caller owns its rejection.
      }
    }

    notificationClaimsReleased = false;
    notificationsDrained = false;
    startPromise = undefined;
    workerStarted = false;
  };

  return { start, stop };
};
