import { ipcRenderer } from "electron";

import type { DesktopBridge } from "../shared/ipc/bridge";
import { APP_START_CHANNEL } from "../shared/ipc/channels";

export const appApi: Pick<DesktopBridge, "startApp"> = {
  startApp: () => ipcRenderer.invoke(APP_START_CHANNEL),
};
