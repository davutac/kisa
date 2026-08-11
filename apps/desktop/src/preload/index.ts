import { contextBridge, webUtils } from "electron";

import { version as appVersion } from "../../package.json";
import type { DesktopBridge } from "../shared/ipc/bridge";
import { appApi } from "./app-api";
import { authApi } from "./auth-api";
import { mailApi } from "./mail-api";
import { settingsApi } from "./settings-api";
import { templateApi } from "./template-api";
import { updateApi } from "./update-api";

const desktopBridge = {
  ...appApi,
  ...authApi,
  ...mailApi,
  ...settingsApi,
  ...templateApi,
  ...updateApi,
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getVersions: () => ({
    app: appVersion,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  }),
} satisfies DesktopBridge;

contextBridge.exposeInMainWorld("desktopBridge", desktopBridge);
