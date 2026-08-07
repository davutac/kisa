import { describe, expect, it } from "@effect/vitest";

import { createUpdateLifecycle } from "../src/main/updates/update-lifecycle";
import type { UpdateStatus } from "../src/shared/update-status";

const createLifecycleHarness = (args?: {
  canSelfUpdate?: () => boolean;
  checkForUpdates?: () => Promise<void>;
}) => {
  const emittedStatuses: UpdateStatus[] = [];
  let didInstall = false;
  const lifecycle = createUpdateLifecycle({
    canSelfUpdate: args?.canSelfUpdate ?? (() => true),
    checkForUpdates: args?.checkForUpdates ?? (async () => {}),
    emitStatus: (status) => {
      emittedStatuses.push(status);
    },
    getFallbackVersion: () => "0.0.0",
    installUpdate: () => {
      didInstall = true;
    },
  });

  return {
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

  it("normalizes download progress and preserves version during progress events", () => {
    const { emittedStatuses, lifecycle } = createLifecycleHarness();

    lifecycle.handleUpdateAvailable("1.2.3");
    lifecycle.handleDownloadProgress({ percent: 123.4 });

    expect(lifecycle.getStatus()).toStrictEqual({
      percent: 100,
      state: "downloading",
      version: "1.2.3",
    });
    expect(emittedStatuses).toStrictEqual([
      { percent: 0, state: "downloading", version: "1.2.3" },
      { percent: 100, state: "downloading", version: "1.2.3" },
    ]);
  });
});
