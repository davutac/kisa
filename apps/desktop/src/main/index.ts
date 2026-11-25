import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { Effect } from "effect";
import { app, session } from "electron";

import icon from "../../build/icon.png?asset";
import { AppClosingEvent } from "../shared/ipc/app";
import { APP_CLOSING_CHANNEL } from "../shared/ipc/channels";
import { configureDevelopmentAiLogging } from "./ai/development-logging";
import { stopThreadCategorization } from "./ai/thread-categorization";
import { registerAppActivation } from "./app/app-activation";
import { setDevelopmentDockIcon } from "./app/app-icon";
import { configureLinuxSecretStorage } from "./app/linux-secret-storage";
import { beginQuit } from "./app/quit-state";
import { createShutdown } from "./app/shutdown";
import { shouldQuitAfterAllWindowsClose } from "./app/window-lifecycle";
import { closeDatabase } from "./database";
import { stopDatabaseImport } from "./database-import";
import { sendRendererEvent } from "./electron/renderer-events";
import { startDesktopIpc, stopDesktopIpc } from "./ipc/desktop-ipc-runtime";
import { stopMailEngine } from "./mail/engine/mail-engine";
import { releaseHeldSends } from "./mail/held-sends";
import { stopScheduledMail } from "./mail/scheduled-mail";
import {
  flushAppSettings,
  getCurrentAppSettings,
  hydrateAppSettings,
} from "./settings/app-settings";
import { createWindow, getMainWindow } from "./window/create-window";
import { installMessageFrameRequestPolicy } from "./window/message-frame-requests";
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

    installMessageFrameRequestPolicy(session.defaultSession);
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

// Above the database process's own five-second close wait, so an orderly
// close always fits. A stage still running past it is left behind, so one
// hung stop can neither skip the database close nor keep the app open.
const SHUTDOWN_STAGE_DEADLINE_MS = 10_000;

const shutdown = createShutdown({
  begin: () => {
    beginQuit();
    sendRendererEvent(APP_CLOSING_CHANNEL, AppClosingEvent, "closing");
    destroyBackgroundTray();
  },
  quit: () => {
    app.quit();
  },
  scheduleDeadline: (run, delayMs) => {
    const timeout = setTimeout(run, delayMs);
    return {
      cancel: () => {
        clearTimeout(timeout);
      },
    };
  },
  stageDeadlineMs: SHUTDOWN_STAGE_DEADLINE_MS,
  // The mail engine stops after scheduled mail, because its stop is what
  // waits for an interrupted send's recovery write; the database closes last.
  // An import still copying is stopped here; one already staged just waits
  // for the next start.
  // Held messages go out before anything that could stop them: the user
  // sent them, so quitting must not leave them for the next start.
  stages: [
    [
      stopThreadCategorization,
      stopDatabaseImport,
      () => Effect.runPromise(releaseHeldSends()),
    ],
    [stopScheduledMail],
    [stopMailEngine],
    [
      flushAppSettings,
      () => Effect.runPromise(closeDatabase()),
      stopDesktopIpc,
    ],
  ],
});

app.on("before-quit", shutdown.handleQuitRequest);

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
