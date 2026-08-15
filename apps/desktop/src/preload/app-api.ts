import { ipcRenderer } from "electron";

import { AppClosingEvent } from "../shared/ipc/app";
import type { DesktopBridge } from "../shared/ipc/bridge";
import {
  APP_CLOSING_CHANNEL,
  APP_GET_SETTINGS_CHANNEL,
  APP_OPEN_THREAD_WINDOW_CHANNEL,
  APP_START_CHANNEL,
  APP_UPDATE_SETTINGS_CHANNEL,
} from "../shared/ipc/channels";
import { subscribe } from "./subscribe";

export const appApi: Pick<
  DesktopBridge,
  | "getAppSettings"
  | "onAppClosing"
  | "openThreadWindow"
  | "setAppSettings"
  | "startApp"
> = {
  getAppSettings: () => ipcRenderer.invoke(APP_GET_SETTINGS_CHANNEL),
  onAppClosing: (listener) =>
    subscribe(APP_CLOSING_CHANNEL, AppClosingEvent, listener),
  openThreadWindow: (request) =>
    ipcRenderer.invoke(APP_OPEN_THREAD_WINDOW_CHANNEL, request),
  setAppSettings: (request) =>
    ipcRenderer.invoke(APP_UPDATE_SETTINGS_CHANNEL, request),
  startApp: () => ipcRenderer.invoke(APP_START_CHANNEL),
};
