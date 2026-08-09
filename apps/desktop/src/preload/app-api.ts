import { ipcRenderer } from "electron";

import { AppClosingEvent } from "../shared/ipc/app";
import type { DesktopBridge } from "../shared/ipc/bridge";
import { APP_CLOSING_CHANNEL, APP_START_CHANNEL } from "../shared/ipc/channels";
import { subscribe } from "./subscribe";

export const appApi: Pick<DesktopBridge, "onAppClosing" | "startApp"> = {
  onAppClosing: (listener) =>
    subscribe(APP_CLOSING_CHANNEL, AppClosingEvent, listener),
  startApp: () => ipcRenderer.invoke(APP_START_CHANNEL),
};
