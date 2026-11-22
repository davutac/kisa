import { Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  createAccountWorker,
  toCycleOutcome,
} from "../src/main/mail/engine/account-worker";
import type {
  AccountCycleOutcome,
  AccountWorkerPhase,
} from "../src/main/mail/engine/account-worker";

const POLL_MS = 120_000;
const RETRY_DELAYS_MS = [5000, 15_000, 60_000, 300_000] as const;

const flushMicrotasks = async (): Promise<void> => {
  for (let turn = 0; turn < 10; turn += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each turn lets one queued continuation run.
    await Promise.resolve();
  }
};

/** A worker whose cycles the test ends by hand and whose timers it fires. */
const createHarness = () => {
  const cycles: {
    readonly finish: (outcome: AccountCycleOutcome) => void;
    readonly syncPassEnded: (caughtUp: boolean) => void;
  }[] = [];
  const timers: {
    cancelled: boolean;
    readonly delayMs: number;
    readonly run: () => void;
  }[] = [];
  const phases: AccountWorkerPhase[] = [];
  const controller = new AbortController();
  const worker = createAccountWorker({
    now: () => 0,
    onPhaseChange: (phase) => {
      phases.push(phase);
    },
    pollIntervalMs: POLL_MS,
    retryDelaysMs: RETRY_DELAYS_MS,
    runCycle: (cycle) => {
      const outcome = Promise.withResolvers<AccountCycleOutcome>();
      cycles.push({
        finish: outcome.resolve,
        syncPassEnded: cycle.syncPassEnded,
      });
      return outcome.promise;
    },
    schedule: (run, delayMs) => {
      const timer = { cancelled: false, delayMs, run };
      timers.push(timer);
      return {
        cancel: () => {
          timer.cancelled = true;
        },
      };
    },
  });
  const ended = vi.fn<() => void>();
  const run = async (): Promise<void> => {
    await worker.run(controller.signal);
    ended();
  };
  void run();

  return {
    abort: () => controller.abort(),
    cycles,
    ended,
    /** Ends the cycle now running. */
    finish: async (outcome: AccountCycleOutcome): Promise<void> => {
      cycles.at(-1)?.finish(outcome);
      await flushMicrotasks();
    },
    /** Lets the wait in progress run out. */
    fireTimer: async (): Promise<void> => {
      timers.findLast((timer) => !timer.cancelled)?.run();
      await flushMicrotasks();
    },
    /** The delays of the timers still waiting. */
    pendingDelays: () =>
      timers.filter((timer) => !timer.cancelled).map((timer) => timer.delayMs),
    phases,
    request: async (
      source: Parameters<typeof worker.requestSync>[0]
    ): Promise<void> => {
      worker.requestSync(source);
      await flushMicrotasks();
    },
    timers,
    worker,
  };
};

const done = { kind: "done", moreWork: false } as const;
const refused = { kind: "sign-in-refused" } as const;

describe(createAccountWorker, () => {
  it("syncs, indexes, then waits for the next poll", async () => {
    const harness = createHarness();
    await flushMicrotasks();

    harness.cycles.at(0)?.syncPassEnded(true);
    await harness.finish(done);

    expect(harness.phases).toStrictEqual([
      { kind: "syncing" },
      { kind: "indexing" },
      { kind: "idle", until: POLL_MS },
    ]);
    expect(harness.pendingDelays()).toStrictEqual([POLL_MS]);

    harness.timers.at(0)?.run();
    await flushMicrotasks();
    expect(harness.cycles).toHaveLength(2);
  });

  it("starts the next cycle at once while work is left or a request waits", async () => {
    const harness = createHarness();
    await flushMicrotasks();

    await harness.finish({ kind: "done", moreWork: true });
    expect(harness.cycles).toHaveLength(2);

    await harness.finish(done);
    await harness.request("automatic");
    expect(harness.cycles).toHaveLength(3);
    expect(harness.pendingDelays()).toStrictEqual([]);
  });

  // The request used to be dropped: only a sleeping loop could be woken, so a
  // sync asked for after a send waited for the next poll.
  it("runs one more cycle for a sync requested while a cycle is running", async () => {
    const harness = createHarness();
    await flushMicrotasks();

    await harness.request("automatic");
    await harness.finish(done);
    expect(harness.cycles).toHaveLength(2);

    await harness.finish(done);
    expect(harness.cycles).toHaveLength(2);
    expect(harness.pendingDelays()).toStrictEqual([POLL_MS]);
  });

  it("retries a failed cycle more slowly each time, and at once when asked", async () => {
    const harness = createHarness();
    await flushMicrotasks();

    await harness.finish({ kind: "failed" });
    expect(harness.worker.phase()).toStrictEqual({
      attempt: 1,
      kind: "retrying",
      serverDelay: false,
      until: 5000,
    });

    harness.timers.at(0)?.run();
    await flushMicrotasks();
    await harness.finish({ kind: "failed" });
    expect(harness.pendingDelays()).toStrictEqual([15_000]);

    await harness.request("automatic");
    expect(harness.cycles).toHaveLength(3);
    await harness.finish(done);
    await harness.request("automatic");
    await harness.finish({ kind: "failed" });
    expect(harness.pendingDelays()).toStrictEqual([5000]);
  });

  it("waits out a delay the server asked for, whoever asks to sync", async () => {
    const harness = createHarness();
    await flushMicrotasks();

    await harness.finish({ kind: "failed", retryAfterMs: 90_000 });
    await harness.request("automatic");
    await harness.request("user");
    await harness.request("account-connected");
    expect(harness.cycles).toHaveLength(1);
    expect(harness.pendingDelays()).toStrictEqual([90_000]);

    harness.timers.at(0)?.run();
    await flushMicrotasks();
    expect(harness.cycles).toHaveLength(2);
  });

  it("waits for a new sign-in after a refused one, and automatic requests do not retry it", async () => {
    const harness = createHarness();
    await flushMicrotasks();

    await harness.finish(refused);
    expect(harness.worker.phase()).toStrictEqual({ kind: "needs-sign-in" });
    expect(harness.pendingDelays()).toStrictEqual([]);

    await harness.request("automatic");
    expect(harness.cycles).toHaveLength(1);
    expect(harness.ended).not.toHaveBeenCalled();
  });

  it.each(["account-connected", "user"] as const)(
    "tries a refused sign-in again on %s",
    async (source) => {
      const harness = createHarness();
      await flushMicrotasks();
      await harness.finish(refused);

      await harness.request(source);

      expect(harness.cycles).toHaveLength(2);
      expect(harness.worker.phase()).toStrictEqual({ kind: "syncing" });
    }
  );

  // The new sign-in can land while the cycle using the old one is still
  // running; that cycle's refusal must not park the account.
  it("gives a sign-in that arrived during a refused cycle exactly one more cycle", async () => {
    const harness = createHarness();
    await flushMicrotasks();

    await harness.request("account-connected");
    await harness.finish(refused);
    expect(harness.cycles).toHaveLength(2);

    await harness.finish(refused);
    expect(harness.cycles).toHaveLength(2);
    expect(harness.worker.phase()).toStrictEqual({ kind: "needs-sign-in" });
  });

  it("ends when the account is gone", async () => {
    const harness = createHarness();
    await flushMicrotasks();

    await harness.finish({ kind: "account-missing" });

    expect(harness.ended).toHaveBeenCalledOnce();
    expect(harness.worker.phase()).toStrictEqual({ kind: "stopped" });
  });

  // Disconnect and quit wait for the worker, so every wait must end on abort.
  it.each([
    { name: "waiting for a sign-in", outcome: refused },
    { name: "waiting to retry", outcome: { kind: "failed" } as const },
    { name: "waiting for the next poll", outcome: done },
  ])("ends on abort while $name", async ({ outcome }) => {
    const harness = createHarness();
    await flushMicrotasks();
    await harness.finish(outcome);

    harness.abort();
    await flushMicrotasks();

    expect(harness.ended).toHaveBeenCalledOnce();
    expect(harness.worker.phase()).toStrictEqual({ kind: "stopped" });
    expect(harness.pendingDelays()).toStrictEqual([]);
  });

  it("ends on abort during a cycle without starting another", async () => {
    const harness = createHarness();
    await flushMicrotasks();

    harness.abort();
    await harness.request("user");
    await harness.finish({ kind: "failed" });

    expect(harness.ended).toHaveBeenCalledOnce();
    expect(harness.cycles).toHaveLength(1);
    expect(harness.pendingDelays()).toStrictEqual([]);
  });
});

/** Fails one cycle per retry step, leaving the next retry running. */
const failUntilLastStep = async (
  harness: ReturnType<typeof createHarness>,
  caughtUp: boolean
): Promise<void> => {
  for (const _step of RETRY_DELAYS_MS) {
    harness.cycles.at(-1)?.syncPassEnded(caughtUp);
    // oxlint-disable-next-line eslint/no-await-in-loop -- One failed cycle after another.
    await harness.finish({ kind: "failed" });
    // oxlint-disable-next-line eslint/no-await-in-loop -- Then its retry.
    await harness.fireTimer();
  }
};

describe("the index status an account worker reports", () => {
  it("reports failure only once retries reach their last step", async () => {
    const harness = createHarness();
    await flushMicrotasks();

    await harness.finish({ kind: "failed" });
    await harness.fireTimer();
    await harness.finish({ kind: "failed" });
    await harness.fireTimer();
    await harness.finish({ kind: "failed" });
    expect(harness.worker.indexStatus()).toBeUndefined();

    await harness.fireTimer();
    await harness.finish({ kind: "failed" });
    expect(harness.worker.indexStatus()).toBe("failed");
  });

  // Every view of indexing reads anything but "running" as not indexing, so
  // a status that cleared for each retry would blink them every few minutes.
  it("keeps reporting failure through its retries, until a sync pass works", async () => {
    const harness = createHarness();
    await flushMicrotasks();
    await failUntilLastStep(harness, false);

    expect(harness.worker.phase()).toStrictEqual({ kind: "syncing" });
    expect(harness.worker.indexStatus()).toBe("failed");

    harness.cycles.at(-1)?.syncPassEnded(true);
    expect(harness.worker.indexStatus()).toBeUndefined();
  });

  it("keeps reporting a needed sign-in through the retry, until a sync pass works", async () => {
    const harness = createHarness();
    await flushMicrotasks();
    await harness.finish(refused);
    expect(harness.worker.indexStatus()).toBe("paused");

    await harness.request("account-connected");
    expect(harness.worker.indexStatus()).toBe("paused");

    harness.cycles.at(-1)?.syncPassEnded(true);
    expect(harness.worker.indexStatus()).toBeUndefined();
  });

  // The server is reachable; what fails comes after the catch-up pass.
  it("backs off without reporting failure while each cycle still catches up", async () => {
    const harness = createHarness();
    await flushMicrotasks();

    await failUntilLastStep(harness, true);
    harness.cycles.at(-1)?.syncPassEnded(true);
    await harness.finish({ kind: "failed" });

    expect(harness.worker.indexStatus()).toBeUndefined();
    expect(harness.pendingDelays()).toStrictEqual([RETRY_DELAYS_MS.at(-1)]);
  });
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
