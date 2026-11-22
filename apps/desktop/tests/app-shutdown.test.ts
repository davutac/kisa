import { describe, expect, it, vi } from "vitest";

import { createShutdown } from "../src/main/app/shutdown";

const STAGE_DEADLINE_MS = 10_000;

const flushMicrotasks = async (): Promise<void> => {
  for (let turn = 0; turn < 10; turn += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each turn lets one queued continuation run.
    await Promise.resolve();
  }
};

/** A cleanup step the test finishes by hand. */
const createStep = () => {
  const { promise, reject, resolve } = Promise.withResolvers<undefined>();
  return {
    fail: reject,
    finish: () => resolve(undefined),
    run: vi.fn<() => Promise<undefined>>(() => promise),
  };
};

const createHarness = (
  stages: readonly (readonly (() => Promise<undefined>)[])[]
) => {
  const deadlines: { readonly delayMs: number; readonly run: () => void }[] =
    [];
  const begin = vi.fn<() => void>();
  const quit = vi.fn<() => void>();
  const cancelDeadline = vi.fn<() => void>();
  const shutdown = createShutdown({
    begin,
    stageDeadlineMs: STAGE_DEADLINE_MS,
    quit,
    scheduleDeadline: (run, delayMs) => {
      deadlines.push({ delayMs, run });
      return { cancel: cancelDeadline };
    },
    stages,
  });
  const requestQuit = () => {
    const request = { preventDefault: vi.fn<() => void>() };
    shutdown.handleQuitRequest(request);
    return request;
  };
  return { begin, cancelDeadline, deadlines, quit, requestQuit };
};

describe(createShutdown, () => {
  it("holds the first quit until cleanup finishes, then lets the quit through", async () => {
    const step = createStep();
    const harness = createHarness([[step.run]]);

    const first = harness.requestQuit();
    await flushMicrotasks();
    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(harness.quit).not.toHaveBeenCalled();

    step.finish();
    await flushMicrotasks();
    expect(harness.quit).toHaveBeenCalledOnce();
    expect(harness.cancelDeadline).toHaveBeenCalledOnce();
    expect(harness.requestQuit().preventDefault).not.toHaveBeenCalled();
  });

  it("holds a second quit request that arrives while cleanup is running", async () => {
    const step = createStep();
    const harness = createHarness([[step.run]]);
    harness.requestQuit();
    await flushMicrotasks();

    const second = harness.requestQuit();

    expect(second.preventDefault).toHaveBeenCalledOnce();
    expect(harness.begin).toHaveBeenCalledOnce();
    expect(step.run).toHaveBeenCalledOnce();
    expect(harness.quit).not.toHaveBeenCalled();
  });

  it("runs stages in order and the steps of one stage together", async () => {
    const first = createStep();
    const secondA = createStep();
    const secondB = createStep();
    const harness = createHarness([[first.run], [secondA.run, secondB.run]]);
    harness.requestQuit();
    await flushMicrotasks();
    expect(secondA.run).not.toHaveBeenCalled();

    first.finish();
    await flushMicrotasks();

    expect(secondA.run).toHaveBeenCalledOnce();
    expect(secondB.run).toHaveBeenCalledOnce();
    expect(harness.quit).not.toHaveBeenCalled();
  });

  it("still runs later stages and quits when a step fails", async () => {
    const failing = createStep();
    const later = createStep();
    const harness = createHarness([[failing.run], [later.run]]);
    harness.requestQuit();
    await flushMicrotasks();

    failing.fail(new Error("stop failed"));
    await flushMicrotasks();
    expect(later.run).toHaveBeenCalledOnce();

    later.finish();
    await flushMicrotasks();
    expect(harness.quit).toHaveBeenCalledOnce();
  });

  it("moves on to the next stage when one hangs past its deadline", async () => {
    const hung = createStep();
    const later = createStep();
    const harness = createHarness([[hung.run], [later.run]]);
    harness.requestQuit();
    await flushMicrotasks();
    expect(harness.deadlines.map((deadline) => deadline.delayMs)).toStrictEqual(
      [STAGE_DEADLINE_MS]
    );

    harness.deadlines.at(0)?.run();
    await flushMicrotasks();
    expect(later.run).toHaveBeenCalledOnce();
    expect(harness.quit).not.toHaveBeenCalled();

    later.finish();
    hung.finish();
    await flushMicrotasks();
    expect(harness.quit).toHaveBeenCalledOnce();
  });
});
