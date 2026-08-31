import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";

import { createScheduledMailLifecycle } from "../src/main/mail/scheduled-mail-lifecycle";

interface ScheduledRetry {
  readonly cancel: Mock<() => void>;
  readonly delayMs: number;
  readonly run: () => void;
}

const START_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16_000, 30_000];

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const runScheduledRetries = async (
  retries: readonly ScheduledRetry[],
  expectedDelays: readonly number[],
  index = 0
): Promise<void> => {
  if (index === expectedDelays.length) {
    return;
  }
  await flushMicrotasks();
  expect(retries[index]?.delayMs).toBe(expectedDelays[index]);
  retries[index]?.run();
  await runScheduledRetries(retries, expectedDelays, index + 1);
};

const createLifecycleHarness = (overrides?: {
  dispatchPendingNotifications?: () => Promise<void>;
  exhaustedRetryDelayMs?: number;
  retryDelaysMs?: readonly number[];
  startWorker?: () => Promise<void>;
}) => {
  const retries: ScheduledRetry[] = [];
  let resumeListener: (() => void) | undefined;
  const removeResumeListener = vi.fn<() => void>(() => {
    resumeListener = undefined;
  });
  const dispatchPendingNotifications = vi.fn<() => Promise<void>>(
    overrides?.dispatchPendingNotifications ?? (async () => {})
  );
  const releaseStaleNotificationClaims = vi.fn<() => Promise<void>>(
    async () => {}
  );
  const startWorker = vi.fn<() => Promise<void>>(
    overrides?.startWorker ?? (async () => {})
  );
  const stopWorker = vi.fn<() => Promise<void>>(async () => {});
  const wakeWorker = vi.fn<() => void>();
  const lifecycleOptions = {
    dispatchPendingNotifications,
    listenForResume: (listener) => {
      resumeListener = listener;
      return removeResumeListener;
    },
    releaseStaleNotificationClaims,
    scheduleRetry: (run, delayMs) => {
      const retry = { cancel: vi.fn<() => void>(), delayMs, run };
      retries.push(retry);
      return retry;
    },
    startWorker,
    stopWorker,
    wakeWorker,
  } satisfies Parameters<typeof createScheduledMailLifecycle>[0];
  const lifecycle = createScheduledMailLifecycle({
    ...lifecycleOptions,
    exhaustedRetryDelayMs: overrides?.exhaustedRetryDelayMs,
    retryDelaysMs: overrides?.retryDelaysMs,
  });

  return {
    dispatchPendingNotifications,
    lifecycle,
    releaseStaleNotificationClaims,
    removeResumeListener,
    get resumeListener() {
      return resumeListener;
    },
    retries,
    startWorker,
    stopWorker,
    wakeWorker,
  };
};

describe(createScheduledMailLifecycle, () => {
  it("recovers when the worker reset fails on its first startup attempt", async () => {
    const harness = createLifecycleHarness({
      startWorker: vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error("temporary database failure"))
        .mockImplementation(async () => {}),
    });

    const started = harness.lifecycle.start();
    await flushMicrotasks();

    expect([
      harness.resumeListener,
      harness.retries.length,
      harness.retries[0]?.delayMs,
    ]).toStrictEqual([expect.any(Function), 1, 1000]);
    harness.retries[0]?.run();
    await started;

    harness.resumeListener?.();
    expect([
      harness.releaseStaleNotificationClaims.mock.calls.length,
      harness.startWorker.mock.calls.length,
      harness.dispatchPendingNotifications.mock.calls.length,
      harness.wakeWorker.mock.calls.length,
      harness.removeResumeListener.mock.calls.length,
    ]).toStrictEqual([1, 2, 1, 1, 0]);

    await harness.lifecycle.stop();
  });

  it("retries a pending-notification failure without restarting the worker", async () => {
    const harness = createLifecycleHarness({
      dispatchPendingNotifications: vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(
          new Error("temporary notification query failure")
        )
        .mockImplementation(async () => {}),
    });

    const started = harness.lifecycle.start();
    await flushMicrotasks();
    harness.retries[0]?.run();
    await started;

    expect(harness.releaseStaleNotificationClaims).toHaveBeenCalledOnce();
    expect(harness.startWorker).toHaveBeenCalledOnce();
    expect(harness.dispatchPendingNotifications).toHaveBeenCalledTimes(2);
    expect(harness.resumeListener).toBeTypeOf("function");

    await harness.lifecycle.stop();
  });

  it("cancels a pending retry and removes the resume listener only on stop", async () => {
    const harness = createLifecycleHarness({
      startWorker: vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error("temporary database failure"))
        .mockImplementation(async () => {}),
    });

    const firstStart = harness.lifecycle.start();
    await flushMicrotasks();
    const [staleRetry] = harness.retries;

    expect([
      harness.resumeListener,
      harness.removeResumeListener.mock.calls.length,
    ]).toStrictEqual([expect.any(Function), 0]);
    await harness.lifecycle.stop();
    await expect(firstStart).resolves.toBeUndefined();

    expect([
      staleRetry?.cancel.mock.calls.length,
      harness.removeResumeListener.mock.calls.length,
      harness.resumeListener,
      harness.stopWorker.mock.calls.length,
    ]).toStrictEqual([1, 1, undefined, 1]);

    const secondStart = harness.lifecycle.start();
    staleRetry?.run();
    await secondStart;

    expect([
      harness.startWorker.mock.calls.length,
      harness.dispatchPendingNotifications.mock.calls.length,
    ]).toStrictEqual([2, 1]);
    await harness.lifecycle.stop();
  });

  it("starts a fresh worker generation on resume after bounded retries are exhausted", async () => {
    let shouldFail = true;
    const harness = createLifecycleHarness({
      startWorker: () => {
        if (shouldFail) {
          return Promise.reject(new Error("persistent failure"));
        }
        return Promise.resolve();
      },
    });

    const firstStart = harness.lifecycle.start();
    await runScheduledRetries(harness.retries, START_RETRY_DELAYS_MS);
    await expect(firstStart).rejects.toThrow("persistent failure");

    expect([
      harness.resumeListener,
      harness.removeResumeListener.mock.calls.length,
      harness.startWorker.mock.calls.length,
    ]).toStrictEqual([expect.any(Function), 0, 7]);

    shouldFail = false;
    harness.resumeListener?.();
    await harness.lifecycle.start();

    expect([
      harness.startWorker.mock.calls.length,
      harness.dispatchPendingNotifications.mock.calls.length,
    ]).toStrictEqual([8, 1]);
    await harness.lifecycle.stop();
    expect(harness.removeResumeListener).toHaveBeenCalledOnce();
  });

  it("keeps a low-frequency recovery retry after bounded startup attempts", async () => {
    let shouldFail = true;
    const harness = createLifecycleHarness({
      exhaustedRetryDelayMs: 300_000,
      startWorker: () =>
        shouldFail
          ? Promise.reject(new Error("persistent failure"))
          : Promise.resolve(),
    });

    const firstStart = harness.lifecycle.start();
    await runScheduledRetries(harness.retries, START_RETRY_DELAYS_MS);
    await expect(firstStart).rejects.toThrow("persistent failure");
    await flushMicrotasks();

    const continuation = harness.retries[START_RETRY_DELAYS_MS.length];
    expect(continuation?.delayMs).toBe(300_000);
    shouldFail = false;
    continuation?.run();
    await flushMicrotasks();

    expect([
      harness.startWorker.mock.calls.length,
      harness.dispatchPendingNotifications.mock.calls.length,
      harness.resumeListener,
    ]).toStrictEqual([8, 1, expect.any(Function)]);
    await harness.lifecycle.stop();
  });

  it("cancels the low-frequency recovery retry on stop", async () => {
    const harness = createLifecycleHarness({
      exhaustedRetryDelayMs: 300_000,
      startWorker: () => Promise.reject(new Error("persistent failure")),
    });

    const firstStart = harness.lifecycle.start();
    await runScheduledRetries(harness.retries, START_RETRY_DELAYS_MS);
    await expect(firstStart).rejects.toThrow("persistent failure");
    await flushMicrotasks();
    const continuation = harness.retries[START_RETRY_DELAYS_MS.length];

    await harness.lifecycle.stop();

    expect([
      continuation?.delayMs,
      continuation?.cancel.mock.calls.length,
      harness.removeResumeListener.mock.calls.length,
      harness.stopWorker.mock.calls.length,
    ]).toStrictEqual([300_000, 1, 1, 1]);
  });

  it("retries an exhausted notification drain on resume without restarting the live worker", async () => {
    let shouldFail = true;
    const harness = createLifecycleHarness({
      dispatchPendingNotifications: () => {
        if (shouldFail) {
          return Promise.reject(new Error("persistent notification failure"));
        }
        return Promise.resolve();
      },
    });

    const firstStart = harness.lifecycle.start();
    await runScheduledRetries(harness.retries, START_RETRY_DELAYS_MS);
    await expect(firstStart).rejects.toThrow("persistent notification failure");

    expect([
      harness.startWorker.mock.calls.length,
      harness.dispatchPendingNotifications.mock.calls.length,
    ]).toStrictEqual([1, 7]);
    shouldFail = false;
    harness.resumeListener?.();
    await harness.lifecycle.start();

    expect([
      harness.wakeWorker.mock.calls.length,
      harness.startWorker.mock.calls.length,
      harness.dispatchPendingNotifications.mock.calls.length,
    ]).toStrictEqual([1, 1, 8]);
    await harness.lifecycle.stop();
  });
});
