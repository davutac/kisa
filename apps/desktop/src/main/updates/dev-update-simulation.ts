import { setTimeout as sleep } from "node:timers/promises";

import type { UpdateLifecycle } from "./update-lifecycle";

const SIMULATED_VERSION = "99.0.0";
const PROGRESS_STEP_PERCENT = 10;
const PROGRESS_STEP_MS = 300;

/**
 * Stands in for electron-updater in development so the update UI can be seen
 * outside a release. It drives the real lifecycle through available,
 * downloading, and ready, but never contacts the update server; installing
 * only returns to idle, so Check for updates in Settings replays it.
 */
export const createUpdateSimulation = (
  getLifecycle: () => UpdateLifecycle
) => ({
  check: (): Promise<void> => {
    getLifecycle().handleUpdateAvailable(SIMULATED_VERSION);
    return Promise.resolve();
  },
  download: async () => {
    for (
      let percent = PROGRESS_STEP_PERCENT;
      percent <= 100;
      percent += PROGRESS_STEP_PERCENT
    ) {
      // Progress steps are deliberately sequential, like a real download.
      // oxlint-disable-next-line no-await-in-loop
      await sleep(PROGRESS_STEP_MS);
      getLifecycle().handleDownloadProgress({ percent });
    }

    getLifecycle().handleUpdateDownloaded(SIMULATED_VERSION);
  },
  install: () => {
    getLifecycle().handleUpdateNotAvailable();
  },
});
