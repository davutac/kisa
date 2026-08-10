import { is } from "@electron-toolkit/utils";
import type { BrowserWindow } from "electron";
import { app } from "electron";
import electronUpdater from "electron-updater";

import { UPDATES_STATUS_CHANNEL } from "../../shared/ipc/channels";
import { UpdateStatus } from "../../shared/update-status";
import { sendRendererEvent } from "../electron/renderer-events";
import { createUpdateLifecycle } from "./update-lifecycle";

const { autoUpdater } = electronUpdater;

const UPDATE_CHECK_DELAY_MS = 3000;
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

let isInitialized = false;

const canSelfUpdate = (): boolean => {
  if (is.dev) {
    return false;
  }

  if (process.platform === "linux") {
    return typeof process.env["APPIMAGE"] === "string";
  }

  return process.platform === "darwin" || process.platform === "win32";
};

const emitUpdateStatus = (status: UpdateStatus): void => {
  sendRendererEvent(UPDATES_STATUS_CHANNEL, UpdateStatus, status);
};

const updateLifecycle = createUpdateLifecycle({
  canSelfUpdate,
  checkForUpdates: async () => {
    await autoUpdater.checkForUpdates();
  },
  emitStatus: emitUpdateStatus,
  getFallbackVersion: () => app.getVersion(),
  installUpdate: () => {
    autoUpdater.quitAndInstall();
  },
});

export const getUpdateStatus = (): UpdateStatus => updateLifecycle.getStatus();

export const checkForUpdates = (): Promise<UpdateStatus> =>
  updateLifecycle.check();

export const installUpdate = (): void => {
  updateLifecycle.install();
};

export const initializeAutoUpdates = (mainWindow: BrowserWindow): void => {
  if (isInitialized) {
    return;
  }

  if (!updateLifecycle.markUnsupportedIfNeeded()) {
    return;
  }

  isInitialized = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    updateLifecycle.handleUpdateAvailable(info.version);
  });

  autoUpdater.on("download-progress", (progress) => {
    updateLifecycle.handleDownloadProgress({ percent: progress.percent });
  });

  autoUpdater.on("update-downloaded", (info) => {
    updateLifecycle.handleUpdateDownloaded(info.version);
  });

  autoUpdater.on("update-not-available", () => {
    updateLifecycle.handleUpdateNotAvailable();
  });

  autoUpdater.on("error", () => {
    updateLifecycle.handleError();
    // Updates are best-effort and should never interrupt normal app startup.
  });

  mainWindow.once("ready-to-show", () => {
    setTimeout(() => {
      void updateLifecycle.check();
    }, UPDATE_CHECK_DELAY_MS);

    setInterval(() => {
      void updateLifecycle.check();
    }, UPDATE_CHECK_INTERVAL_MS);
  });
};
