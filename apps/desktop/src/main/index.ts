import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { Effect } from "effect";
import { app } from "electron";

import icon from "../../build/icon.png?asset";
import { AppClosingEvent } from "../shared/ipc/app";
import { APP_CLOSING_CHANNEL } from "../shared/ipc/channels";
import { registerAppActivation } from "./app/app-activation";
import { setDevelopmentDockIcon } from "./app/app-icon";
import { configureLinuxSecretStorage } from "./app/linux-secret-storage";
import { beginQuit } from "./app/quit-state";
import { stopGoogleAuth } from "./auth/auth";
import { closeDatabase } from "./database";
import { sendRendererEvent } from "./electron/renderer-events";
import { startDesktopIpc, stopDesktopIpc } from "./ipc/desktop-ipc-runtime";
import { stopMailSync } from "./mail/mail-sync";
import {
  getCurrentAppSettings,
  hydrateAppSettings,
} from "./settings/app-settings";
import { createWindow, getMainWindow } from "./window/create-window";
import { destroyBackgroundTray, setBackgroundTray } from "./window/tray";

configureLinuxSecretStorage({
  commandLine: app.commandLine,
  currentDesktop: process.env["XDG_CURRENT_DESKTOP"],
  platform: process.platform,
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (hasSingleInstanceLock) {
  registerAppActivation(getMainWindow);

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  void (async (): Promise<void> => {
    await app.whenReady();

    setDevelopmentDockIcon({
      dock: process.platform === "darwin" ? app.dock : undefined,
      icon,
      isDevelopment: is.dev,
      platform: process.platform,
    });

    // Set app user model id for windows
    electronApp.setAppUserModelId("com.kisa.app");

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on("browser-window-created", (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });

    await startDesktopIpc();
    hydrateAppSettings();
    createWindow();

    if (getCurrentAppSettings().runInBackground) {
      setBackgroundTray(true, getMainWindow);
    }

    app.on("activate", () => {
      // On macOS the dock icon is clicked even when the window is hidden in
      // the tray, so restore it instead of recreating a second window.
      const window = getMainWindow();

      if (window === undefined) {
        createWindow();
        return;
      }

      if (window.isMinimized()) {
        window.restore();
      }

      window.show();
      window.focus();
    });
  })();
} else {
  app.quit();
}

let shutdownStarted = false;

const finishShutdown = async (): Promise<void> => {
  stopGoogleAuth();
  destroyBackgroundTray();
  await Promise.allSettled([
    Effect.runPromise(closeDatabase()),
    stopDesktopIpc(),
  ]);
  app.quit();
};

app.on("before-quit", (event) => {
  if (shutdownStarted) {
    return;
  }

  event.preventDefault();
  beginQuit();
  shutdownStarted = true;
  sendRendererEvent(APP_CLOSING_CHANNEL, AppClosingEvent, "closing");
  stopMailSync();
  void finishShutdown();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
