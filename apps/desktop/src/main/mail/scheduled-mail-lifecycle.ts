import { Cause, Duration, Effect, Exit, Fiber, Schedule, Schema } from "effect";
import type { Context } from "effect";

/**
 * A startup step that fails is tried again after 1, 2, 4, 8 and 16 seconds,
 * then 30: seven attempts in all.
 */
const startRetrySchedule = Schedule.exponential("1 second").pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, Duration.seconds(30)))
  ),
  Schedule.upTo({ times: 6 })
);

/** After a step runs out of attempts, startup is tried again this long after. */
const EXHAUSTED_RETRY_DELAY = Duration.minutes(5);

// oxlint-disable-next-line unicorn/throw-new-error -- Effect Schema tagged errors are declared as generated classes.
class ScheduledMailLifecycleError extends Schema.TaggedError<
  ScheduledMailLifecycleError,
  { readonly brand: unique symbol }
>()("ScheduledMailLifecycleError", { message: Schema.String }) {}

const lifecycleError = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Step failures are unknown at this boundary.
  error: unknown
): ScheduledMailLifecycleError =>
  new ScheduledMailLifecycleError({
    message:
      error instanceof Error
        ? error.message
        : "Scheduled mail startup operation failed",
  });

// A step is not interrupted while it runs, so stopping waits for one in
// flight instead of leaving it to finish after the worker has stopped.
const step = (operation: Effect.Effect<void, unknown>) =>
  operation.pipe(
    Effect.mapError(lifecycleError),
    Effect.uninterruptible,
    Effect.retry(startRetrySchedule)
  );

interface ScheduledMailLifecycleOptions {
  readonly dispatchPendingNotifications: Effect.Effect<void, unknown>;
  readonly listenForResume: (listener: () => void) => () => void;
  readonly releaseStaleNotificationClaims: Effect.Effect<void, unknown>;
  readonly startWorker: Effect.Effect<void, unknown>;
  readonly stopWorker: Effect.Effect<void, unknown>;
  readonly wakeWorker: () => void;
}

interface ScheduledMailLifecycle {
  /**
   * Starts scheduled mail, and fails once a step has used up its attempts.
   * Stopping meanwhile ends it without failing.
   */
  readonly start: Effect.Effect<void, ScheduledMailLifecycleError>;
  readonly stop: Effect.Effect<void, ScheduledMailLifecycleError>;
}

/**
 * Brings scheduled mail up: stale notification claims are released, the
 * worker started, and pending notifications shown, each step retried on its
 * own and done once. A run of attempts that gives up is tried again later,
 * and on resume from sleep; stopping ends whatever is still waiting.
 */
export const createScheduledMailLifecycle = (
  options: ScheduledMailLifecycleOptions
): ScheduledMailLifecycle => {
  let active = false;
  let notificationClaimsReleased = false;
  let notificationsDrained = false;
  let workerStarted = false;
  let removeResumeListener: (() => void) | undefined;
  /** Where resume and recovery run: the context `start` was first run in. */
  let context: Context.Context<never> | undefined;

  /** The startup run in progress, which every caller of `start` shares. */
  let running:
    | {
        readonly fiber: Fiber.Fiber<void, ScheduledMailLifecycleError>;
        readonly token: object;
      }
    | undefined;

  /** The later attempt armed after a run gave up. */
  let recovery: Fiber.Fiber<void> | undefined;

  const runSteps = Effect.gen(function* runScheduledMailStartup() {
    if (!notificationClaimsReleased) {
      yield* step(options.releaseStaleNotificationClaims);
      notificationClaimsReleased = true;
    }

    if (!workerStarted) {
      yield* step(options.startWorker);
      workerStarted = true;
    }

    if (!notificationsDrained) {
      yield* step(options.dispatchPendingNotifications);
      notificationsDrained = true;
    }
  });

  const cancelRecovery = Effect.suspend(() => {
    const pending = recovery;
    recovery = undefined;

    return pending === undefined ? Effect.void : Fiber.interrupt(pending);
  });

  const armRecovery: Effect.Effect<void> = Effect.suspend(() => {
    if (
      !active ||
      (workerStarted && notificationsDrained) ||
      recovery !== undefined
    ) {
      return Effect.void;
    }

    return Effect.forkDetach(
      Effect.sleep(EXHAUSTED_RETRY_DELAY).pipe(
        Effect.andThen(
          Effect.suspend(() => {
            // Cleared first, so starting does not interrupt this fiber.
            recovery = undefined;

            return beginRun;
          })
        ),
        Effect.asVoid
      )
    ).pipe(
      Effect.flatMap((fiber) =>
        Effect.sync(() => {
          recovery = fiber;
        })
      )
    );
  });

  const beginRun: Effect.Effect<
    Fiber.Fiber<void, ScheduledMailLifecycleError>
  > = Effect.gen(function* beginScheduledMailStartup() {
    if (running !== undefined) {
      return running.fiber;
    }

    yield* cancelRecovery;

    if (!workerStarted) {
      notificationClaimsReleased = false;
    }

    const token = {};

    // Detached, so a caller that stops waiting does not end the run. A
    // forked fiber starts on a later tick, after `running` names it.
    const fiber = yield* Effect.forkDetach(
      runSteps.pipe(
        Effect.onExit((exit) =>
          Effect.suspend(() => {
            if (running?.token !== token) {
              return Effect.void;
            }

            running = undefined;

            return Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)
              ? armRecovery
              : Effect.void;
          })
        )
      )
    );

    running = { fiber, token };

    return fiber;
  });

  const handleResume = (): void => {
    if (!active || context === undefined) {
      return;
    }

    if (workerStarted) {
      options.wakeWorker();
    }

    if (!workerStarted || !notificationsDrained) {
      Effect.runForkWith(context)(beginRun);
    }
  };

  const start = Effect.gen(function* startScheduledMail() {
    if (!active) {
      active = true;
      context = yield* Effect.context<never>();
      removeResumeListener = options.listenForResume(handleResume);
    }

    if (notificationsDrained) {
      return;
    }

    const exit = yield* Fiber.await(yield* beginRun);

    if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
      return yield* exit;
    }
  });

  const stop = Effect.gen(function* stopScheduledMail() {
    if (!active) {
      return;
    }

    active = false;
    removeResumeListener?.();
    removeResumeListener = undefined;
    yield* cancelRecovery;
    const pending = running;
    running = undefined;

    if (pending !== undefined) {
      yield* Fiber.interrupt(pending.fiber);
    }

    yield* options.stopWorker.pipe(Effect.mapError(lifecycleError));

    notificationClaimsReleased = false;
    notificationsDrained = false;
    workerStarted = false;
  });

  return { start, stop };
};
