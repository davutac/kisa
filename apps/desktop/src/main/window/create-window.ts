import path from "node:path";

import { is } from "@electron-toolkit/utils";
import { BrowserWindow } from "electron";

import { APP_NAME } from "@/constants";

import icon from "../../../build/icon.png?asset";
import { openExternalUrl } from "../electron/shell";
import { initializeAutoUpdates } from "../updates/updater";
import {
  MIN_WINDOW_SIZE,
  readWindowState,
  writeWindowState,
} from "./window-state";

const TITLEBAR_HEIGHT = 42;
const TRAFFIC_LIGHT_INSET = 18;
const TRAFFIC_LIGHT_SIZE = 14;

const isSameDocumentNavigation = (
  currentUrl: string,
  navigationUrl: string
): boolean => {
  try {
    const current = new URL(currentUrl);
    const navigation = new URL(navigationUrl);

    return (
      current.protocol === navigation.protocol &&
      current.host === navigation.host &&
      current.pathname === navigation.pathname
    );
  } catch {
    return false;
  }
};

export const createWindow = (): BrowserWindow => {
  const { isMaximized, ...windowBounds } = readWindowState();
  const mainWindow = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: "#121212",
    ...windowBounds,
    minHeight: MIN_WINDOW_SIZE.height,
    minWidth: MIN_WINDOW_SIZE.width,
    ...(process.platform === "darwin"
      ? {
          trafficLightPosition: {
            x: TRAFFIC_LIGHT_INSET,
            y: Math.round((TITLEBAR_HEIGHT - TRAFFIC_LIGHT_SIZE) / 2),
          },
        }
      : {}),
    ...(process.platform === "linux" ? { icon } : {}),
    show: false,
    title: APP_NAME,
    titleBarOverlay: {
      color: "#ffffff00",
      height: TITLEBAR_HEIGHT,
      symbolColor: "#f5f5f5",
    },
    titleBarStyle: "hidden",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(import.meta.dirname, "../preload/index.cjs"),
      sandbox: true,
    },
  });

  if (isMaximized === true) {
    mainWindow.maximize();
  }

  initializeAutoUpdates(mainWindow);

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });
  mainWindow.on("close", () => {
    writeWindowState(mainWindow);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isSameDocumentNavigation(mainWindow.webContents.getURL(), url)) {
      return;
    }

    event.preventDefault();
    openExternalUrl(url);
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    void mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void mainWindow.loadFile(
      path.join(import.meta.dirname, "../renderer/index.html")
    );
  }

  return mainWindow;
};
