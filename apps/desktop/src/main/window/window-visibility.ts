import { app, BrowserWindow } from "electron";

import {
  setWindowTaskbarVisibility,
  updateDockVisibility,
} from "../app/background-visibility";

const DOCK_HIDE_VERIFICATION_DELAY_MS = 1100;

let dockHideVerification: NodeJS.Timeout | undefined;

const syncDockVisibility = (): boolean =>
  updateDockVisibility({
    dock: process.platform === "darwin" ? app.dock : undefined,
    platform: process.platform,
    windows: BrowserWindow.getAllWindows(),
  });

const cancelDockHideVerification = (): void => {
  if (dockHideVerification !== undefined) {
    clearTimeout(dockHideVerification);
    dockHideVerification = undefined;
  }
};

const verifyDockWasHidden = (): void => {
  if (process.platform !== "darwin") {
    return;
  }

  cancelDockHideVerification();
  // Electron can ignore dock.hide() calls made within one second of the
  // previous call. Reconcile once outside that interval after a hide event.
  dockHideVerification = setTimeout(() => {
    dockHideVerification = undefined;
    syncDockVisibility();
  }, DOCK_HIDE_VERIFICATION_DELAY_MS);
  dockHideVerification.unref();
};

const syncHiddenWindowState = (): void => {
  if (!syncDockVisibility()) {
    verifyDockWasHidden();
  }
};

export const installWindowVisibility = (window: BrowserWindow): void => {
  window.on("show", () => {
    cancelDockHideVerification();
    setWindowTaskbarVisibility(window, true, process.platform);
    syncDockVisibility();
  });
  window.on("hide", syncHiddenWindowState);
  window.on("closed", () => {
    queueMicrotask(syncHiddenWindowState);
  });
};

export const hideWindowInBackground = (window: BrowserWindow): void => {
  setWindowTaskbarVisibility(window, false, process.platform);
  window.hide();
};
