import { Effect, Exit } from "effect";

import type { UpdateStatus } from "../../shared/update-status";
import { normalizeUpdateStatus } from "../../shared/update-status";

interface UpdateLifecycleOptions {
  canSelfUpdate: () => boolean;
  checkForUpdates: () => Promise<void>;
  emitStatus: (status: UpdateStatus) => void;
  getFallbackVersion: () => string;
  initialStatus?: UpdateStatus;
  installUpdate: () => void;
}

export interface UpdateLifecycle {
  check: () => Promise<UpdateStatus>;
  getStatus: () => UpdateStatus;
  handleDownloadProgress: (progress: { percent: number }) => void;
  handleError: () => void;
  handleUpdateAvailable: (version: string) => void;
  handleUpdateDownloaded: (version: string) => void;
  handleUpdateNotAvailable: () => void;
  install: () => void;
  markUnsupportedIfNeeded: () => boolean;
}

export const createUpdateLifecycle = ({
  canSelfUpdate,
  checkForUpdates,
  emitStatus,
  getFallbackVersion,
  initialStatus = { state: "idle" },
  installUpdate,
}: UpdateLifecycleOptions): UpdateLifecycle => {
  let currentStatus = normalizeUpdateStatus(initialStatus);
  let isCheckingForUpdates = false;

  const publishStatus = (status: UpdateStatus): UpdateStatus => {
    currentStatus = normalizeUpdateStatus(status);
    emitStatus(currentStatus);

    return currentStatus;
  };

  const markUnsupportedIfNeeded = (): boolean => {
    if (canSelfUpdate()) {
      return true;
    }

    publishStatus({ state: "unsupported" });
    return false;
  };

  return {
    check: async () => {
      if (!markUnsupportedIfNeeded()) {
        return currentStatus;
      }

      if (isCheckingForUpdates || currentStatus.state !== "idle") {
        return currentStatus;
      }

      isCheckingForUpdates = true;
      publishStatus({ state: "checking" });

      const checkExit = await Effect.runPromiseExit(
        Effect.tryPromise(checkForUpdates)
      );

      if (Exit.isFailure(checkExit)) {
        publishStatus({ state: "idle" });
      }

      isCheckingForUpdates = false;
      return currentStatus;
    },
    getStatus: () => currentStatus,
    handleDownloadProgress: ({ percent }) => {
      const version =
        currentStatus.state === "downloading"
          ? currentStatus.version
          : getFallbackVersion();

      publishStatus({ percent, state: "downloading", version });
    },
    handleError: () => {
      publishStatus({ state: "idle" });
    },
    handleUpdateAvailable: (version) => {
      publishStatus({ percent: 0, state: "downloading", version });
    },
    handleUpdateDownloaded: (version) => {
      publishStatus({ state: "ready", version });
    },
    handleUpdateNotAvailable: () => {
      publishStatus({ state: "idle" });
    },
    install: () => {
      if (currentStatus.state === "ready") {
        installUpdate();
      }
    },
    markUnsupportedIfNeeded,
  };
};
