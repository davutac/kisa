// Oxlint does not recognize @effect/vitest's it.effect as a test declaration.
// oxlint-disable vitest/no-standalone-expect
import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";
import { vi } from "vitest";

import { createScheduledMailLifecycle } from "../src/main/mail/scheduled-mail-lifecycle";

/** Every startup retry together: 1 + 2 + 4 + 8 + 16 + 30 seconds. */
const ALL_START_RETRIES = "61 seconds";
const RECOVERY_DELAY = "5 minutes";

// oxlint-disable-next-line unicorn/throw-new-error -- Effect Schema tagged errors are declared as generated classes.
class StepFailure extends Schema.TaggedError<
  StepFailure,
  { readonly brand: unique symbol }
>()("StepFailure", { message: Schema.String }) {}

/** A step that fails while `failing` says so, counting every attempt. */
const fakeStep = (failing: () => boolean, message: string) =>
  vi.fn<() => Effect.Effect<void, StepFailure>>(() =>
    failing() ? Effect.fail(new StepFailure({ message })) : Effect.void
  );

/** A step that fails its first `times` attempts, then succeeds. */
const failingTimes = (times: number, message: string) => {
  let remaining = times;
  return fakeStep(() => {
    remaining -= 1;
    return remaining >= 0;
  }, message);
};

const succeeding = () => fakeStep(() => false, "");

const createLifecycleHarness = (overrides?: {
  dispatchPendingNotifications?: ReturnType<typeof fakeStep>;
  startWorker?: ReturnType<typeof fakeStep>;
}) => {
  let resumeListener: (() => void) | undefined;
  const removeResumeListener = vi.fn<() => void>(() => {
    resumeListener = undefined;
  });
  const dispatchPendingNotifications =
    overrides?.dispatchPendingNotifications ?? succeeding();
  const releaseStaleNotificationClaims = succeeding();
  const startWorker = overrides?.startWorker ?? succeeding();
  const stopWorker = succeeding();
  const wakeWorker = vi.fn<() => void>();
  const lifecycle = createScheduledMailLifecycle({
    dispatchPendingNotifications: Effect.suspend(dispatchPendingNotifications),
    listenForResume: (listener) => {
      resumeListener = listener;
      return removeResumeListener;
    },
    releaseStaleNotificationClaims: Effect.suspend(
      releaseStaleNotificationClaims
    ),
    startWorker: Effect.suspend(startWorker),
    stopWorker: Effect.suspend(stopWorker),
    wakeWorker,
  });

  return {
    dispatchPendingNotifications,
    lifecycle,
    releaseStaleNotificationClaims,
    removeResumeListener,
    get resumeListener() {
      return resumeListener;
    },
    startWorker,
    stopWorker,
    wakeWorker,
  };
};

describe("the scheduled mail lifecycle", () => {
  it.effect(
    "recovers when the worker reset fails on its first startup attempt",
    () =>
      Effect.gen(function* recoversFromFirstFailure() {
        const harness = createLifecycleHarness({
          startWorker: failingTimes(1, "temporary database failure"),
        });

        const started = yield* Effect.forkChild(harness.lifecycle.start);
        yield* TestClock.adjust("999 millis");
        expect(harness.startWorker).toHaveBeenCalledOnce();
        yield* TestClock.adjust("1 millis");
        yield* Fiber.join(started);

        harness.resumeListener?.();
        expect([
          harness.releaseStaleNotificationClaims.mock.calls.length,
          harness.startWorker.mock.calls.length,
          harness.dispatchPendingNotifications.mock.calls.length,
          harness.wakeWorker.mock.calls.length,
          harness.removeResumeListener.mock.calls.length,
        ]).toStrictEqual([1, 2, 1, 1, 0]);

        yield* harness.lifecycle.stop;
      })
  );

  it.effect(
    "retries a pending-notification failure without restarting the worker",
    () =>
      Effect.gen(function* retriesNotificationFailure() {
        const harness = createLifecycleHarness({
          dispatchPendingNotifications: failingTimes(
            1,
            "temporary notification query failure"
          ),
        });

        const started = yield* Effect.forkChild(harness.lifecycle.start);
        yield* TestClock.adjust("1 second");
        yield* Fiber.join(started);

        expect([
          harness.releaseStaleNotificationClaims.mock.calls.length,
          harness.startWorker.mock.calls.length,
          harness.dispatchPendingNotifications.mock.calls.length,
        ]).toStrictEqual([1, 1, 2]);
        expect(harness.resumeListener).toBeTypeOf("function");

        yield* harness.lifecycle.stop;
      })
  );

  it.effect(
    "cancels a pending retry and removes the resume listener only on stop",
    () =>
      Effect.gen(function* cancelsPendingRetry() {
        const harness = createLifecycleHarness({
          startWorker: failingTimes(1, "temporary database failure"),
        });

        const firstStart = yield* Effect.forkChild(harness.lifecycle.start);
        yield* TestClock.adjust("500 millis");
        expect([
          harness.startWorker.mock.calls.length,
          harness.removeResumeListener.mock.calls.length,
        ]).toStrictEqual([1, 0]);

        yield* harness.lifecycle.stop;
        yield* Fiber.join(firstStart);
        yield* TestClock.adjust("1 minute");

        expect([
          harness.startWorker.mock.calls.length,
          harness.removeResumeListener.mock.calls.length,
          harness.resumeListener,
          harness.stopWorker.mock.calls.length,
        ]).toStrictEqual([1, 1, undefined, 1]);

        yield* harness.lifecycle.start;

        expect([
          harness.startWorker.mock.calls.length,
          harness.dispatchPendingNotifications.mock.calls.length,
        ]).toStrictEqual([2, 1]);
        yield* harness.lifecycle.stop;
      })
  );

  it.effect(
    "starts a fresh run on resume after the startup retries are used up",
    () =>
      Effect.gen(function* resumesAfterExhaustion() {
        let shouldFail = true;
        const harness = createLifecycleHarness({
          startWorker: fakeStep(() => shouldFail, "persistent failure"),
        });

        const firstStart = yield* Effect.forkChild(
          Effect.flip(harness.lifecycle.start)
        );
        yield* TestClock.adjust(ALL_START_RETRIES);
        const failure = yield* Fiber.join(firstStart);

        expect(failure.message).toBe("persistent failure");
        expect([
          harness.resumeListener,
          harness.removeResumeListener.mock.calls.length,
          harness.startWorker.mock.calls.length,
        ]).toStrictEqual([expect.any(Function), 0, 7]);

        shouldFail = false;
        harness.resumeListener?.();
        yield* harness.lifecycle.start;

        expect([
          harness.startWorker.mock.calls.length,
          harness.dispatchPendingNotifications.mock.calls.length,
        ]).toStrictEqual([8, 1]);
        yield* harness.lifecycle.stop;
        expect(harness.removeResumeListener).toHaveBeenCalledOnce();
      })
  );

  it.effect(
    "tries again five minutes after the startup retries are used up",
    () =>
      Effect.gen(function* recoversLater() {
        let shouldFail = true;
        const harness = createLifecycleHarness({
          startWorker: fakeStep(() => shouldFail, "persistent failure"),
        });

        const firstStart = yield* Effect.forkChild(
          Effect.flip(harness.lifecycle.start)
        );
        yield* TestClock.adjust(ALL_START_RETRIES);
        yield* Fiber.join(firstStart);

        shouldFail = false;
        yield* TestClock.adjust("4 minutes");
        expect(harness.startWorker).toHaveBeenCalledTimes(7);
        yield* TestClock.adjust("1 minute");

        expect([
          harness.startWorker.mock.calls.length,
          harness.dispatchPendingNotifications.mock.calls.length,
          harness.resumeListener,
        ]).toStrictEqual([8, 1, expect.any(Function)]);
        yield* harness.lifecycle.stop;
      })
  );

  it.effect("cancels the later attempt on stop", () =>
    Effect.gen(function* cancelsRecovery() {
      const harness = createLifecycleHarness({
        startWorker: fakeStep(() => true, "persistent failure"),
      });

      const firstStart = yield* Effect.forkChild(
        Effect.flip(harness.lifecycle.start)
      );
      yield* TestClock.adjust(ALL_START_RETRIES);
      yield* Fiber.join(firstStart);

      yield* harness.lifecycle.stop;
      yield* TestClock.adjust(RECOVERY_DELAY);

      expect([
        harness.startWorker.mock.calls.length,
        harness.removeResumeListener.mock.calls.length,
        harness.stopWorker.mock.calls.length,
      ]).toStrictEqual([7, 1, 1]);
    })
  );

  it.effect(
    "retries a used-up notification drain on resume without restarting the live worker",
    () =>
      Effect.gen(function* resumesNotificationDrain() {
        let shouldFail = true;
        const harness = createLifecycleHarness({
          dispatchPendingNotifications: fakeStep(
            () => shouldFail,
            "persistent notification failure"
          ),
        });

        const firstStart = yield* Effect.forkChild(
          Effect.flip(harness.lifecycle.start)
        );
        yield* TestClock.adjust(ALL_START_RETRIES);
        const failure = yield* Fiber.join(firstStart);

        expect(failure.message).toBe("persistent notification failure");
        expect([
          harness.startWorker.mock.calls.length,
          harness.dispatchPendingNotifications.mock.calls.length,
        ]).toStrictEqual([1, 7]);
        shouldFail = false;
        harness.resumeListener?.();
        yield* harness.lifecycle.start;

        expect([
          harness.wakeWorker.mock.calls.length,
          harness.startWorker.mock.calls.length,
          harness.dispatchPendingNotifications.mock.calls.length,
        ]).toStrictEqual([1, 1, 8]);
        yield* harness.lifecycle.stop;
      })
  );

  it.effect("waits for a step in flight before stopping the worker", () =>
    Effect.gen(function* waitsForStepInFlight() {
      const events: string[] = [];
      const startWorker = vi.fn<() => Effect.Effect<void, StepFailure>>(() =>
        Effect.sleep("2 seconds").pipe(
          Effect.andThen(Effect.sync(() => events.push("worker started")))
        )
      );
      const harness = createLifecycleHarness({ startWorker });
      harness.stopWorker.mockReturnValue(
        Effect.sync(() => events.push("worker stopped"))
      );

      yield* Effect.forkChild(harness.lifecycle.start);
      yield* TestClock.adjust("1 second");
      const stopping = yield* Effect.forkChild(harness.lifecycle.stop);
      yield* TestClock.adjust("1 second");
      yield* Fiber.join(stopping);

      expect(events).toStrictEqual(["worker started", "worker stopped"]);
    })
  );
});
