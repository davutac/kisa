import { ipcRenderer } from "electron";

import type { DesktopBridge } from "../shared/ipc/bridge";
import {
  UPDATES_CHECK_CHANNEL,
  UPDATES_DOWNLOAD_CHANNEL,
  UPDATES_GET_STATUS_CHANNEL,
  UPDATES_INSTALL_CHANNEL,
  UPDATES_STATUS_CHANNEL,
} from "../shared/ipc/channels";
import { UpdateStatus } from "../shared/update-status";
import { subscribe } from "./subscribe";

export const updateApi: Pick<
  DesktopBridge,
  | "checkForUpdates"
  | "downloadUpdate"
  | "getUpdateStatus"
  | "installUpdate"
  | "onUpdateStatus"
> = {
  checkForUpdates: () => ipcRenderer.invoke(UPDATES_CHECK_CHANNEL),
  downloadUpdate: () => ipcRenderer.invoke(UPDATES_DOWNLOAD_CHANNEL),
  getUpdateStatus: () => ipcRenderer.invoke(UPDATES_GET_STATUS_CHANNEL),
  installUpdate: () => ipcRenderer.invoke(UPDATES_INSTALL_CHANNEL),
  onUpdateStatus: (listener) =>
    subscribe(UPDATES_STATUS_CHANNEL, UpdateStatus, listener),
};
