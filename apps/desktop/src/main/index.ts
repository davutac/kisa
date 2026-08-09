import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { Effect } from "effect";
import { app, BrowserWindow } from "electron";

import icon from "../../build/icon.png?asset";
import { setDevelopmentDockIcon } from "./app/app-icon";
import { registerAppProtocol } from "./app/app-protocol";
import { handleGoogleAuthCallback } from "./auth/auth";
import { closeDatabase } from "./database";
import { startDesktopIpc, stopDesktopIpc } from "./ipc/desktop-ipc-runtime";
import { stopMailSync } from "./mail/mail-sync";
import { createWindow } from "./window/create-window";

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (hasSingleInstanceLock) {
  registerAppProtocol({
    getWindow: () => BrowserWindow.getAllWindows()[0],
    onGoogleCallback: handleGoogleAuthCallback,
  });

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
    createWindow();

    app.on("activate", () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  })();
} else {
  app.quit();
}

let shutdownStarted = false;

const finishShutdown = async (): Promise<void> => {
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
  shutdownStarted = true;
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
