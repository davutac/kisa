// Oxlint does not recognize @effect/vitest's it.effect as a test declaration.
// oxlint-disable vitest/no-standalone-expect
import { describe, expect, it } from "@effect/vitest";
import { Clock, Deferred, Effect, Exit, Fiber, Queue } from "effect";
import { TestClock } from "effect/testing";

import {
  createAccountWorker,
  toCycleOutcome,
} from "../src/main/mail/engine/account-worker";
import type {
  AccountCycleOutcome,
  AccountWatchOutcome,
  AccountWorkerPhase,
} from "../src/main/mail/engine/account-worker";

const POLL_MS = 120_000;
const RETRY_DELAYS_MS = [5000, 15_000, 60_000, 300_000] as const;
const WATCH_SPACING_MS = 5000;

/** A cycle the worker has started; the test says how it ends. */
interface StartedCycle {
  readonly fail: Effect.Effect<void>;
  readonly finish: (outcome: AccountCycleOutcome) => Effect.Effect<void>;
  readonly syncPassEnded: (caughtUp: boolean) => void;
}

/** A wait on the server the worker has started; the test says how it ends. */
interface StartedWatch {
  readonly fail: Effect.Effect<void>;
  readonly finish: (outcome: AccountWatchOutcome) => Effect.Effect<void>;
  /** Completed when the worker asks the wait to stop. */
  readonly stop: Deferred.Deferred<void>;
}

/**
 * Lets the worker run as far as it can. Only for saying that it did nothing:
 * what it does is waited for on the harness's queues.
 */
const settle = Effect.forEach(
  Array.from({ length: 20 }),
  () => Effect.yieldNow,
  { discard: true }
);

/**
 * A running worker whose cycles, and with `watched` its waits on the server,
 * the test ends by hand. Time is the test clock's.
 */
const createHarness = Effect.fnUntraced(function* createHarness(
  options: { readonly watched?: boolean } = {}
) {
  const cycles = yield* Queue.unbounded<StartedCycle>();
  const watches = yield* Queue.unbounded<StartedWatch>();
  const phaseChanges = yield* Queue.unbounded<AccountWorkerPhase>();
  const phases: AccountWorkerPhase[] = [];
  /** What happened at the end, in order. */
  const ending: string[] = [];
  const started = { cycles: 0, watches: 0 };

  const base = {
    onPhaseChange: (phase: AccountWorkerPhase) => {
      phases.push(phase);
      if (phase.kind === "stopped") {
        ending.push("stopped");
      }
      Queue.offerUnsafe(phaseChanges, phase);
    },
    pollIntervalMs: POLL_MS,
    retryDelaysMs: RETRY_DELAYS_MS,
    runCycle: Effect.fnUntraced(function* runCycle(cycle: {
      readonly syncPassEnded: (caughtUp: boolean) => void;
    }) {
      const outcome = yield* Deferred.make<AccountCycleOutcome, string>();
      started.cycles += 1;
      yield* Queue.offer(cycles, {
        fail: Effect.asVoid(Deferred.fail(outcome, "the cycle failed")),
        finish: (value) => Effect.asVoid(Deferred.succeed(outcome, value)),
        syncPassEnded: cycle.syncPassEnded,
      });
      return yield* Deferred.await(outcome);
    }),
  };
  const watch = Effect.fnUntraced(
    function* watch(stop: Deferred.Deferred<void>) {
      const outcome = yield* Deferred.make<AccountWatchOutcome, string>();
      started.watches += 1;
      yield* Queue.offer(watches, {
        fail: Effect.asVoid(Deferred.fail(outcome, "the wait failed")),
        finish: (value) => Effect.asVoid(Deferred.succeed(outcome, value)),
        stop,
      });
      return yield* Deferred.await(outcome);
    },
    Effect.onInterrupt(() =>
      Effect.sync(() => {
        ending.push("wait dropped");
      })
    )
  );

  const worker = createAccountWorker(
    options.watched === true
      ? { ...base, watch, watchSpacingMs: WATCH_SPACING_MS }
      : base
  );
  const fiber = yield* Effect.forkScoped(worker.run);

  return {
    cycles,
    ending,
    fiber,
    /** Waits until the worker enters a phase of this kind. */
    phase: Effect.fnUntraced(function* phase(kind: AccountWorkerPhase["kind"]) {
      for (;;) {
        const changed = yield* Queue.take(phaseChanges);
        if (changed.kind === kind) {
          return changed;
        }
      }
    }),
    phases,
    started,
    watches,
    worker,
  };
});

type Harness = Effect.Success<ReturnType<typeof createHarness>>;

const done = { kind: "done", moreWork: false } as const;
const failed = { kind: "failed" } as const;
const refused = { kind: "sign-in-refused" } as const;

/** A worker whose first cycle has ended this way, in the wait that follows. */
const afterFirstCycle = Effect.fnUntraced(function* afterFirstCycle(
  outcome: AccountCycleOutcome,
  options: { readonly watched?: boolean } = {}
) {
  const harness = yield* createHarness(options);
  const first = yield* Queue.take(harness.cycles);
  yield* first.finish(outcome);
  return harness;
});

describe(createAccountWorker, () => {
  it.effect("syncs, indexes, then waits for the next poll", () =>
    Effect.gen(function* polls() {
      const harness = yield* createHarness();
      const first = yield* Queue.take(harness.cycles);

      first.syncPassEnded(true);
      yield* first.finish(done);
      yield* harness.phase("idle");

      expect(harness.phases).toStrictEqual([
        { kind: "syncing" },
        { kind: "indexing" },
        { kind: "idle", until: POLL_MS },
      ]);
      yield* TestClock.adjust(POLL_MS - 1);
      yield* settle;
      expect(harness.started.cycles).toBe(1);

      yield* TestClock.adjust(1);
      yield* Queue.take(harness.cycles);
      expect(harness.started.cycles).toBe(2);
    })
  );

  it.effect(
    "starts the next cycle at once while work is left or a request waits",
    () =>
      Effect.gen(function* atOnce() {
        const harness = yield* afterFirstCycle({
          kind: "done",
          moreWork: true,
        });
        const second = yield* Queue.take(harness.cycles);

        yield* second.finish(done);
        yield* harness.phase("idle");
        harness.worker.requestSync("automatic");
        yield* Queue.take(harness.cycles);

        expect(harness.started.cycles).toBe(3);
      })
  );

  // The request used to be dropped: only a sleeping loop could be woken, so a
  // sync asked for after a send waited for the next poll.
  it.effect(
    "runs one more cycle for a sync requested while a cycle is running",
    () =>
      Effect.gen(function* remembered() {
        const harness = yield* createHarness();
        const first = yield* Queue.take(harness.cycles);

        harness.worker.requestSync("automatic");
        yield* first.finish(done);
        const second = yield* Queue.take(harness.cycles);
        yield* second.finish(done);
        yield* harness.phase("idle");
        yield* settle;
        expect(harness.started.cycles).toBe(2);

        yield* TestClock.adjust(POLL_MS);
        yield* Queue.take(harness.cycles);
        expect(harness.started.cycles).toBe(3);
      })
  );

  it.effect(
    "retries a failed cycle more slowly each time, and at once when asked",
    () =>
      Effect.gen(function* retries() {
        const harness = yield* afterFirstCycle(failed);
        yield* harness.phase("retrying");
        expect(harness.worker.phase()).toStrictEqual({
          attempt: 1,
          kind: "retrying",
          serverDelay: false,
          until: 5000,
        });

        yield* TestClock.adjust(5000);
        const second = yield* Queue.take(harness.cycles);
        yield* second.finish(failed);
        yield* harness.phase("retrying");
        expect(harness.worker.phase()).toMatchObject({
          attempt: 2,
          until: 5000 + 15_000,
        });

        harness.worker.requestSync("automatic");
        const third = yield* Queue.take(harness.cycles);
        yield* third.finish(done);
        yield* harness.phase("idle");
        harness.worker.requestSync("automatic");
        const fourth = yield* Queue.take(harness.cycles);
        yield* fourth.finish(failed);
        yield* harness.phase("retrying");
        expect(harness.worker.phase()).toMatchObject({
          attempt: 1,
          until: 5000 + 5000,
        });
      })
  );

  // The engine sorts its cycles' failures into outcomes itself. One that
  // fails anyway must not end the loop.
  it.effect("retries a cycle that fails outright, like any failed cycle", () =>
    Effect.gen(function* failsOutright() {
      const harness = yield* createHarness();
      const first = yield* Queue.take(harness.cycles);

      yield* first.fail;
      yield* harness.phase("retrying");

      expect(harness.worker.phase()).toMatchObject({
        attempt: 1,
        until: RETRY_DELAYS_MS[0],
      });
    })
  );

  it.effect(
    "waits out a delay the server asked for, whoever asks to sync",
    () =>
      Effect.gen(function* serverDelay() {
        const harness = yield* afterFirstCycle({
          kind: "failed",
          retryAfterMs: 90_000,
        });
        yield* harness.phase("retrying");

        harness.worker.requestSync("automatic");
        harness.worker.requestSync("user");
        harness.worker.requestSync("account-connected");
        yield* TestClock.adjust(90_000 - 1);
        yield* settle;
        expect(harness.started.cycles).toBe(1);

        yield* TestClock.adjust(1);
        yield* Queue.take(harness.cycles);
        expect(harness.started.cycles).toBe(2);
      })
  );

  it.effect(
    "waits for a new sign-in after a refused one, and automatic requests do not retry it",
    () =>
      Effect.gen(function* parked() {
        const harness = yield* afterFirstCycle(refused);
        yield* harness.phase("needs-sign-in");

        harness.worker.requestSync("automatic");
        yield* TestClock.adjust(POLL_MS * 10);
        yield* settle;

        expect(harness.started.cycles).toBe(1);
        expect(harness.worker.phase()).toStrictEqual({ kind: "needs-sign-in" });
      })
  );

  for (const source of ["account-connected", "user"] as const) {
    it.effect(`tries a refused sign-in again on ${source}`, () =>
      Effect.gen(function* signedInAgain() {
        const harness = yield* afterFirstCycle(refused);
        yield* harness.phase("needs-sign-in");

        harness.worker.requestSync(source);
        yield* Queue.take(harness.cycles);

        expect(harness.started.cycles).toBe(2);
        expect(harness.worker.phase()).toStrictEqual({ kind: "syncing" });
      })
    );
  }

  // The new sign-in can land while the cycle using the old one is still
  // running; that cycle's refusal must not park the account.
  it.effect(
    "gives a sign-in that arrived during a refused cycle exactly one more cycle",
    () =>
      Effect.gen(function* oneMore() {
        const harness = yield* createHarness();
        const first = yield* Queue.take(harness.cycles);

        harness.worker.requestSync("account-connected");
        yield* first.finish(refused);
        const second = yield* Queue.take(harness.cycles);
        yield* second.finish(refused);
        yield* harness.phase("needs-sign-in");
        yield* settle;

        expect(harness.started.cycles).toBe(2);
        expect(harness.worker.phase()).toStrictEqual({ kind: "needs-sign-in" });
      })
  );

  it.effect("ends when the account is gone", () =>
    Effect.gen(function* gone() {
      const harness = yield* afterFirstCycle({ kind: "account-missing" });

      yield* Fiber.join(harness.fiber);

      expect(harness.worker.phase()).toStrictEqual({ kind: "stopped" });
    })
  );

  // Disconnect and quit wait for the worker, so interrupting it must end
  // every wait.
  for (const { name, outcome, waiting } of [
    {
      name: "waiting for a sign-in",
      outcome: refused,
      waiting: "needs-sign-in",
    },
    { name: "waiting to retry", outcome: failed, waiting: "retrying" },
    { name: "waiting for the next poll", outcome: done, waiting: "idle" },
  ] as const) {
    it.effect(`ends when interrupted while ${name}`, () =>
      Effect.gen(function* interruptedWaiting() {
        const harness = yield* afterFirstCycle(outcome);
        yield* harness.phase(waiting);

        yield* Fiber.interrupt(harness.fiber);

        expect(harness.worker.phase()).toStrictEqual({ kind: "stopped" });
      })
    );
  }

  it.effect(
    "ends when interrupted during a cycle without starting another",
    () =>
      Effect.gen(function* interruptedSyncing() {
        const harness = yield* createHarness();
        yield* Queue.take(harness.cycles);

        yield* Fiber.interrupt(harness.fiber);
        harness.worker.requestSync("user");
        yield* settle;

        // The cycle it cut off is not counted as one that failed.
        expect(harness.phases).toStrictEqual([
          { kind: "syncing" },
          { kind: "stopped" },
        ]);
        expect(harness.started.cycles).toBe(1);
      })
  );
});

describe("an account worker that can wait on its server", () => {
  it.effect(
    "waits on the server instead of polling, and syncs when it has news",
    () =>
      Effect.gen(function* news() {
        const harness = yield* afterFirstCycle(done, { watched: true });
        const watched = yield* Queue.take(harness.watches);

        yield* TestClock.adjust(POLL_MS * 3);
        yield* settle;
        expect(harness.worker.phase().kind).toBe("idle");
        expect(harness.started.cycles).toBe(1);

        yield* watched.finish("sync");
        yield* Queue.take(harness.cycles);
        expect(harness.started.cycles).toBe(2);
      })
  );

  it.effect("polls when the server cannot be waited on", () =>
    Effect.gen(function* unavailable() {
      const harness = yield* afterFirstCycle(done, { watched: true });
      const watched = yield* Queue.take(harness.watches);

      yield* watched.finish("unavailable");
      yield* TestClock.adjust(POLL_MS - 1);
      yield* settle;
      expect(harness.started.cycles).toBe(1);

      yield* TestClock.adjust(1);
      yield* Queue.take(harness.cycles);
      expect(harness.started.cycles).toBe(2);
    })
  );

  // A server that drops every wait must not be answered with a cycle each time.
  it.effect("polls after a wait that failed", () =>
    Effect.gen(function* failedWait() {
      const harness = yield* afterFirstCycle(done, { watched: true });
      const watched = yield* Queue.take(harness.watches);
      yield* TestClock.adjust(90_000);

      yield* watched.fail;
      yield* TestClock.adjust(POLL_MS - 90_000 - 1);
      yield* settle;
      expect(harness.started.cycles).toBe(1);

      yield* TestClock.adjust(1);
      yield* Queue.take(harness.cycles);
      expect(harness.started.cycles).toBe(2);
    })
  );

  // The cycle needs the connection the wait holds.
  it.effect(
    "ends the wait for a requested sync, and starts the cycle once it has ended",
    () =>
      Effect.gen(function* stopped() {
        const harness = yield* afterFirstCycle(done, { watched: true });
        const watched = yield* Queue.take(harness.watches);

        harness.worker.requestSync("automatic");
        yield* settle;
        expect(yield* Deferred.isDone(watched.stop)).toBeTruthy();
        expect(harness.started.cycles).toBe(1);

        yield* watched.finish("unavailable");
        yield* Queue.take(harness.cycles);
        expect(harness.started.cycles).toBe(2);
      })
  );

  it.effect("keeps the cycles a busy server asks for apart", () =>
    Effect.gen(function* spaced() {
      const harness = yield* afterFirstCycle(done, { watched: true });
      const firstWatch = yield* Queue.take(harness.watches);
      yield* firstWatch.finish("sync");
      const second = yield* Queue.take(harness.cycles);

      yield* TestClock.adjust(1000);
      yield* second.finish(done);
      const secondWatch = yield* Queue.take(harness.watches);
      yield* secondWatch.finish("sync");
      yield* TestClock.adjust(WATCH_SPACING_MS - 1000 - 1);
      yield* settle;
      expect(harness.started.cycles).toBe(2);

      yield* TestClock.adjust(1);
      yield* Queue.take(harness.cycles);
      expect(harness.started.cycles).toBe(3);
    })
  );

  it.effect("syncs at once on news that comes after a quiet spell", () =>
    Effect.gen(function* quietSpell() {
      const harness = yield* afterFirstCycle(done, { watched: true });
      const firstWatch = yield* Queue.take(harness.watches);
      yield* firstWatch.finish("sync");
      const second = yield* Queue.take(harness.cycles);

      yield* TestClock.adjust(WATCH_SPACING_MS);
      yield* second.finish(done);
      const secondWatch = yield* Queue.take(harness.watches);
      yield* secondWatch.finish("sync");
      yield* Queue.take(harness.cycles);

      expect(harness.started.cycles).toBe(3);
    })
  );

  it.effect(
    "does not wait on the server while it waits to retry or to sign in",
    () =>
      Effect.gen(function* notIdle() {
        const harness = yield* afterFirstCycle(failed, { watched: true });
        yield* harness.phase("retrying");
        yield* settle;
        expect(harness.started.watches).toBe(0);

        yield* TestClock.adjust(RETRY_DELAYS_MS[0]);
        const second = yield* Queue.take(harness.cycles);
        yield* second.finish(refused);
        yield* harness.phase("needs-sign-in");
        yield* settle;
        expect(harness.started.watches).toBe(0);
      })
  );

  // Quit and disconnect close the connection; the wait is not asked to leave
  // it usable, which would wait on a server that may be gone.
  it.effect("drops the wait when interrupted, and ends once it has gone", () =>
    Effect.gen(function* dropped() {
      const harness = yield* afterFirstCycle(done, { watched: true });
      const watched = yield* Queue.take(harness.watches);

      yield* Fiber.interrupt(harness.fiber);

      expect(yield* Deferred.isDone(watched.stop)).toBeFalsy();
      expect(harness.ending).toStrictEqual(["wait dropped", "stopped"]);
      expect(harness.started.cycles).toBe(1);
    })
  );
});

/** Fails one cycle per retry step, and returns the cycle running after. */
const failUntilLastStep = Effect.fnUntraced(function* failUntilLastStep(
  harness: Harness,
  first: StartedCycle,
  caughtUp: boolean
) {
  let running = first;
  for (const delay of RETRY_DELAYS_MS) {
    running.syncPassEnded(caughtUp);
    yield* running.finish(failed);
    yield* harness.phase("retrying");
    yield* TestClock.adjust(delay);
    running = yield* Queue.take(harness.cycles);
  }
  return running;
});

describe("the index status an account worker reports", () => {
  it.effect("reports failure only once retries reach their last step", () =>
    Effect.gen(function* lastStep() {
      const harness = yield* createHarness();
      let running = yield* Queue.take(harness.cycles);
      for (const delay of RETRY_DELAYS_MS.slice(0, 2)) {
        yield* running.finish(failed);
        yield* harness.phase("retrying");
        yield* TestClock.adjust(delay);
        running = yield* Queue.take(harness.cycles);
      }

      yield* running.finish(failed);
      yield* harness.phase("retrying");
      expect(harness.worker.indexStatus()).toBeUndefined();

      yield* TestClock.adjust(RETRY_DELAYS_MS[2]);
      const fourth = yield* Queue.take(harness.cycles);
      yield* fourth.finish(failed);
      yield* harness.phase("retrying");
      expect(harness.worker.indexStatus()).toBe("failed");
    })
  );

  // Every view of indexing reads anything but "running" as not indexing, so
  // a status that cleared for each retry would blink them every few minutes.
  it.effect(
    "keeps reporting failure through its retries, until a sync pass works",
    () =>
      Effect.gen(function* keepsFailing() {
        const harness = yield* createHarness();
        const first = yield* Queue.take(harness.cycles);
        const running = yield* failUntilLastStep(harness, first, false);

        expect(harness.worker.phase()).toStrictEqual({ kind: "syncing" });
        expect(harness.worker.indexStatus()).toBe("failed");

        running.syncPassEnded(true);
        expect(harness.worker.indexStatus()).toBeUndefined();
      })
  );

  it.effect(
    "keeps reporting a needed sign-in through the retry, until a sync pass works",
    () =>
      Effect.gen(function* keepsPaused() {
        const harness = yield* afterFirstCycle(refused);
        yield* harness.phase("needs-sign-in");
        expect(harness.worker.indexStatus()).toBe("paused");

        harness.worker.requestSync("account-connected");
        const second = yield* Queue.take(harness.cycles);
        expect(harness.worker.indexStatus()).toBe("paused");

        second.syncPassEnded(true);
        expect(harness.worker.indexStatus()).toBeUndefined();
      })
  );

  // The server is reachable; what fails comes after the catch-up pass.
  it.effect(
    "backs off without reporting failure while each cycle still catches up",
    () =>
      Effect.gen(function* catchesUp() {
        const harness = yield* createHarness();
        const first = yield* Queue.take(harness.cycles);
        const running = yield* failUntilLastStep(harness, first, true);

        running.syncPassEnded(true);
        yield* running.finish(failed);
        yield* harness.phase("retrying");

        expect(harness.worker.indexStatus()).toBeUndefined();
        expect(harness.worker.phase()).toMatchObject({
          until: (yield* Clock.currentTimeMillis) + RETRY_DELAYS_MS[3],
        });
      })
  );
});

describe(toCycleOutcome, () => {
  it("tells a refused sign-in, a missing account and a server delay apart", () => {
    expect(toCycleOutcome(Exit.succeed({ moreWork: true }))).toStrictEqual({
      kind: "done",
      moreWork: true,
    });
    expect(toCycleOutcome(Exit.fail({ _tag: "MailAuthError" }))).toStrictEqual({
      kind: "sign-in-refused",
    });
    expect(
      toCycleOutcome(Exit.fail({ _tag: "MailEngineError" }))
    ).toStrictEqual({ kind: "account-missing" });
    expect(
      toCycleOutcome(
        Exit.fail({ _tag: "MailThrottledError", retryAfterMs: 90_000 })
      )
    ).toStrictEqual({ kind: "failed", retryAfterMs: 90_000 });
    expect(toCycleOutcome(Exit.die("defect"))).toStrictEqual({
      kind: "failed",
      retryAfterMs: undefined,
    });
  });
});
