import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { Effect } from "effect";
import { app } from "electron";

import icon from "../../build/icon.png?asset";
import { AppClosingEvent } from "../shared/ipc/app";
import { APP_CLOSING_CHANNEL } from "../shared/ipc/channels";
import { configureDevelopmentAiLogging } from "./ai/development-logging";
import { stopThreadCategorization } from "./ai/thread-categorization";
import { registerAppActivation } from "./app/app-activation";
import { setDevelopmentDockIcon } from "./app/app-icon";
import { configureLinuxSecretStorage } from "./app/linux-secret-storage";
import { beginQuit } from "./app/quit-state";
import { shouldQuitAfterAllWindowsClose } from "./app/window-lifecycle";
import { stopGoogleAuth } from "./auth/auth";
import { closeDatabase } from "./database";
import { sendRendererEvent } from "./electron/renderer-events";
import { startDesktopIpc, stopDesktopIpc } from "./ipc/desktop-ipc-runtime";
import { stopMailSync } from "./mail/mail-sync";
import { stopScheduledMail } from "./mail/scheduled-mail";
import {
  flushAppSettings,
  getCurrentAppSettings,
  hydrateAppSettings,
} from "./settings/app-settings";
import { createWindow, getMainWindow } from "./window/create-window";
import { destroyBackgroundTray, setBackgroundTray } from "./window/tray";
import { installWindowVisibility } from "./window/window-visibility";

configureDevelopmentAiLogging(is.dev);

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

    // Apply shared behavior to main, thread, and preview windows.
    app.on("browser-window-created", (_, window) => {
      optimizer.watchWindowShortcuts(window);
      installWindowVisibility(window);
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
  await stopThreadCategorization();
  await stopScheduledMail();
  await Promise.allSettled([
    flushAppSettings(),
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

// The event only fires after the last native window closes. Background mode
// keeps the main window hidden, so reaching this path with it disabled should
// quit on every platform, including macOS.
app.on("window-all-closed", () => {
  if (
    shouldQuitAfterAllWindowsClose(
      process.platform,
      getCurrentAppSettings().runInBackground
    )
  ) {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
