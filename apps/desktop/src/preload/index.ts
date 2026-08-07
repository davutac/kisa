import { contextBridge } from "electron";

import type { DesktopBridge } from "../shared/ipc/bridge";
import { appApi } from "./app-api";
import { authApi } from "./auth-api";
import { mailApi } from "./mail-api";
import { settingsApi } from "./settings-api";
import { updateApi } from "./update-api";

const desktopBridge = {
  ...appApi,
  ...authApi,
  ...mailApi,
  ...settingsApi,
  ...updateApi,
  getVersions: () => ({
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  }),
} satisfies DesktopBridge;

contextBridge.exposeInMainWorld("desktopBridge", desktopBridge);
