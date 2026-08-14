import { describe, expect, it } from "@effect/vitest";

import { createUpdateLifecycle } from "../src/main/updates/update-lifecycle";
import type { UpdateStatus } from "../src/shared/update-status";

const createLifecycleHarness = (args?: {
  canSelfUpdate?: () => boolean;
  checkForUpdates?: () => Promise<void>;
  downloadUpdate?: () => Promise<void>;
}) => {
  const emittedStatuses: UpdateStatus[] = [];
  let didDownload = false;
  let didInstall = false;
  const lifecycle = createUpdateLifecycle({
    canSelfUpdate: args?.canSelfUpdate ?? (() => true),
    checkForUpdates: args?.checkForUpdates ?? (async () => {}),
    downloadUpdate: async () => {
      didDownload = true;
      await args?.downloadUpdate?.();
    },
    emitStatus: (status) => {
      emittedStatuses.push(status);
    },
    installUpdate: () => {
      didInstall = true;
    },
  });

  return {
    get didDownload() {
      return didDownload;
    },
    get didInstall() {
      return didInstall;
    },
    emittedStatuses,
    lifecycle,
  };
};

describe(createUpdateLifecycle, () => {
  it("marks unsupported updates without calling the updater adapter", async () => {
    let didCheck = false;
    const { emittedStatuses, lifecycle } = createLifecycleHarness({
      canSelfUpdate: () => false,
      checkForUpdates: () => {
        didCheck = true;
        return Promise.resolve();
      },
    });

    const status = await lifecycle.check();

    expect(status).toStrictEqual({ state: "unsupported" });
    expect(emittedStatuses).toStrictEqual([{ state: "unsupported" }]);
    expect(didCheck).toBeFalsy();
  });

  it("resets to idle when the updater adapter fails", async () => {
    const { emittedStatuses, lifecycle } = createLifecycleHarness({
      checkForUpdates: () => Promise.reject(new Error("network")),
    });

    const status = await lifecycle.check();

    expect(status).toStrictEqual({ state: "idle" });
    expect(emittedStatuses).toStrictEqual([
      { state: "checking" },
      { state: "idle" },
    ]);
  });

  it("keeps install behind the ready state", () => {
    const harness = createLifecycleHarness();

    harness.lifecycle.install();
    expect(harness.didInstall).toBeFalsy();

    harness.lifecycle.handleUpdateDownloaded("1.2.3");
    harness.lifecycle.install();

    expect(harness.didInstall).toBeTruthy();
  });

  it("waits for an explicit download after finding an update", async () => {
    const harness = createLifecycleHarness();

    harness.lifecycle.handleUpdateAvailable("1.2.3");

    expect(harness.lifecycle.getStatus()).toStrictEqual({
      state: "available",
      version: "1.2.3",
    });
    expect(harness.didDownload).toBeFalsy();

    await harness.lifecycle.download();

    expect(harness.didDownload).toBeTruthy();
    expect(harness.lifecycle.getStatus()).toStrictEqual({
      percent: 0,
      state: "downloading",
      version: "1.2.3",
    });
  });

  it("makes a failed download available to retry", async () => {
    const harness = createLifecycleHarness({
      downloadUpdate: () => Promise.reject(new Error("network")),
    });

    harness.lifecycle.handleUpdateAvailable("1.2.3");
    await harness.lifecycle.download();

    expect(harness.lifecycle.getStatus()).toStrictEqual({
      state: "available",
      version: "1.2.3",
    });
  });

  it("normalizes download progress and preserves version during progress events", async () => {
    const { emittedStatuses, lifecycle } = createLifecycleHarness();

    lifecycle.handleUpdateAvailable("1.2.3");
    await lifecycle.download();
    lifecycle.handleDownloadProgress({ percent: 123.4 });

    expect(lifecycle.getStatus()).toStrictEqual({
      percent: 100,
      state: "downloading",
      version: "1.2.3",
    });
    expect(emittedStatuses).toStrictEqual([
      { state: "available", version: "1.2.3" },
      { percent: 0, state: "downloading", version: "1.2.3" },
      { percent: 100, state: "downloading", version: "1.2.3" },
    ]);
  });

  it("ignores download progress outside an active download", () => {
    const { emittedStatuses, lifecycle } = createLifecycleHarness();

    lifecycle.handleDownloadProgress({ percent: 50 });

    expect(lifecycle.getStatus()).toStrictEqual({ state: "idle" });
    expect(emittedStatuses).toStrictEqual([]);
  });
});
