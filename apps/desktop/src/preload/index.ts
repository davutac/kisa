import { contextBridge } from "electron";

import { version as appVersion } from "../../package.json";
import type { DesktopBridge } from "../shared/ipc/bridge";
import { accountsApi } from "./accounts-api";
import { aiApi } from "./ai-api";
import { appApi } from "./app-api";
import { mailApi } from "./mail-api";
import { scheduledMailApi } from "./scheduled-mail-api";
import { settingsApi } from "./settings-api";
import { templateApi } from "./template-api";
import { updateApi } from "./update-api";

const desktopBridge = {
  ...aiApi,
  ...appApi,
  ...accountsApi,
  ...mailApi,
  ...scheduledMailApi,
  ...settingsApi,
  ...templateApi,
  ...updateApi,
  getVersions: () => ({
    app: appVersion,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  }),
} satisfies DesktopBridge;

contextBridge.exposeInMainWorld("desktopBridge", desktopBridge);
