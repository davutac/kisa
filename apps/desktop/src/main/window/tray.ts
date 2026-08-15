import type { BrowserWindow } from "electron";
import { Menu, Tray, app, nativeImage } from "electron";

import { APP_NAME } from "@/constants";

import icon from "../../../build/icon.png?asset";

let tray: Tray | undefined;

const showMainWindow = (getWindow: () => BrowserWindow | undefined): void => {
  const window = getWindow();

  if (window === undefined || window.isDestroyed()) {
    return;
  }

  if (window.isMinimized()) {
    window.restore();
  }

  window.show();
  window.focus();
};

const createBackgroundTray = (
  getWindow: () => BrowserWindow | undefined
): void => {
  if (tray !== undefined) {
    return;
  }

  const image = nativeImage
    .createFromPath(icon)
    .resize({ height: 16, width: 16 });

  tray = new Tray(image);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { click: () => showMainWindow(getWindow), label: `Open ${APP_NAME}` },
      { click: () => app.quit(), label: "Quit" },
    ])
  );
};

export const setBackgroundTray = (
  enabled: boolean,
  getWindow: () => BrowserWindow | undefined
): void => {
  if (enabled) {
    createBackgroundTray(getWindow);
    return;
  }

  if (tray !== undefined) {
    tray.destroy();
    tray = undefined;
  }
};

export const destroyBackgroundTray = (): void => {
  if (tray !== undefined) {
    tray.destroy();
    tray = undefined;
  }
};
