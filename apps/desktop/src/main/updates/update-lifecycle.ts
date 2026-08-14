import { Effect, Exit } from "effect";

import type { UpdateStatus } from "../../shared/update-status";
import { normalizeUpdateStatus } from "../../shared/update-status";

interface UpdateLifecycleOptions {
  canSelfUpdate: () => boolean;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  emitStatus: (status: UpdateStatus) => void;
  initialStatus?: UpdateStatus;
  installUpdate: () => void;
}

export interface UpdateLifecycle {
  check: () => Promise<UpdateStatus>;
  download: () => Promise<UpdateStatus>;
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
  downloadUpdate,
  emitStatus,
  initialStatus = { state: "idle" },
  installUpdate,
}: UpdateLifecycleOptions): UpdateLifecycle => {
  let currentStatus = normalizeUpdateStatus(initialStatus);
  let isCheckingForUpdates = false;

  const readStatus = (): UpdateStatus => currentStatus;

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
    download: async () => {
      if (currentStatus.state !== "available") {
        return currentStatus;
      }

      const { version } = currentStatus;
      publishStatus({ percent: 0, state: "downloading", version });

      const downloadExit = await Effect.runPromiseExit(
        Effect.tryPromise(downloadUpdate)
      );
      const statusAfterDownload = readStatus();

      if (
        Exit.isFailure(downloadExit) &&
        statusAfterDownload.state === "downloading"
      ) {
        publishStatus({ state: "available", version });
      }

      return currentStatus;
    },
    getStatus: readStatus,
    handleDownloadProgress: ({ percent }) => {
      if (currentStatus.state !== "downloading") {
        return;
      }

      publishStatus({
        percent,
        state: "downloading",
        version: currentStatus.version,
      });
    },
    handleError: () => {
      if (currentStatus.state === "downloading") {
        publishStatus({
          state: "available",
          version: currentStatus.version,
        });
        return;
      }

      publishStatus({ state: "idle" });
    },
    handleUpdateAvailable: (version) => {
      publishStatus({ state: "available", version });
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
