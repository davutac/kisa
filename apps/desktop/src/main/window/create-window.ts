import path from "node:path";

import { is } from "@electron-toolkit/utils";
import type { BrowserWindow } from "electron";

import { APP_NAME } from "@/constants";
import type { ThreadWindowOpenRequest } from "@/shared/ipc/app";

import { applyNativeMailIndexProgress } from "../app/native-mail-index-progress";
import { openExternalUrl } from "../electron/shell";
import { initializeAutoUpdates } from "../updates/updater";
import { createBrowserWindow } from "./browser-window";
import { installNativeContextMenu } from "./native-context-menu";
import {
  MIN_WINDOW_SIZE,
  readWindowState,
  writeWindowState,
} from "./window-state";

const THREAD_WINDOW_SIZE = {
  height: 720,
  minHeight: 420,
  minWidth: 520,
  width: 760,
} as const;

interface ThreadWindowEntry {
  readonly loaded: Promise<void>;
  readonly window: BrowserWindow;
}

let mainWindow: BrowserWindow | undefined;
const threadWindows = new Map<string, ThreadWindowEntry>();

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

const installWindowBehavior = (window: BrowserWindow): void => {
  applyNativeMailIndexProgress(window);
  installNativeContextMenu(window);

  window.on("ready-to-show", () => {
    window.show();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isSameDocumentNavigation(window.webContents.getURL(), url)) {
      return;
    }

    event.preventDefault();
    openExternalUrl(url);
  });
};

const loadRenderer = (window: BrowserWindow, hash?: string): Promise<void> => {
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    const url = new URL(process.env["ELECTRON_RENDERER_URL"]);

    if (hash !== undefined) {
      url.hash = hash;
    }

    return window.loadURL(url.toString());
  }

  return window.loadFile(
    path.join(import.meta.dirname, "../renderer/index.html"),
    hash === undefined ? {} : { hash }
  );
};

export const getMainWindow = (): BrowserWindow | undefined =>
  mainWindow?.isDestroyed() === false ? mainWindow : undefined;

export const createWindow = (): BrowserWindow => {
  const { isMaximized, ...windowBounds } = readWindowState();
  const window = createBrowserWindow({
    ...windowBounds,
    minHeight: MIN_WINDOW_SIZE.height,
    minWidth: MIN_WINDOW_SIZE.width,
    title: APP_NAME,
  });
  mainWindow = window;

  installWindowBehavior(window);

  if (isMaximized === true) {
    window.maximize();
  }

  initializeAutoUpdates(window);

  window.on("close", () => {
    writeWindowState(window);
  });
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = undefined;
    }
  });

  void loadRenderer(window);

  return window;
};

const getThreadWindowKey = ({
  accountId,
  threadId,
}: ThreadWindowOpenRequest): string => `${accountId}\u0000${threadId}`;

const focusWindow = (window: BrowserWindow): void => {
  if (window.isMinimized()) {
    window.restore();
  }

  window.show();
  window.focus();
};

export const openThreadWindow = async (
  request: ThreadWindowOpenRequest
): Promise<BrowserWindow> => {
  const key = getThreadWindowKey(request);
  const existing = threadWindows.get(key);

  if (existing !== undefined && !existing.window.isDestroyed()) {
    await existing.loaded;
    focusWindow(existing.window);
    return existing.window;
  }

  const { isMaximized, ...windowBounds } = readWindowState("thread");
  const window = createBrowserWindow({
    ...THREAD_WINDOW_SIZE,
    ...windowBounds,
    title: `Conversation — ${APP_NAME}`,
  });
  if (isMaximized === true) {
    window.maximize();
  }
  const threadRoute = `/thread/${encodeURIComponent(request.accountId)}/${encodeURIComponent(request.threadId)}`;
  installWindowBehavior(window);
  const entry = { loaded: loadRenderer(window, threadRoute), window };
  threadWindows.set(key, entry);

  window.on("close", () => {
    writeWindowState(window, "thread");
  });
  window.on("closed", () => {
    if (threadWindows.get(key) === entry) {
      threadWindows.delete(key);
    }
  });

  try {
    await entry.loaded;
    return window;
  } catch (error) {
    if (!window.isDestroyed()) {
      window.destroy();
    }
    throw error;
  }
};
