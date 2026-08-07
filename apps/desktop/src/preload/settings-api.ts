import { ipcRenderer } from "electron";

import type { DesktopBridge } from "../shared/ipc/bridge";
import {
  SETTINGS_ACCOUNT_SETTINGS_CHANGED_CHANNEL,
  SETTINGS_LIST_ACCOUNT_SETTINGS_CHANNEL,
  SETTINGS_UPDATE_ACCOUNT_SETTINGS_CHANNEL,
} from "../shared/ipc/channels";
import { AccountSettingsReply } from "../shared/ipc/settings";
import { subscribe } from "./subscribe";

export const settingsApi: Pick<
  DesktopBridge,
  "listAccountSettings" | "onAccountSettingsChanged" | "updateAccountSettings"
> = {
  listAccountSettings: () =>
    ipcRenderer.invoke(SETTINGS_LIST_ACCOUNT_SETTINGS_CHANNEL),
  onAccountSettingsChanged: (listener) =>
    subscribe(
      SETTINGS_ACCOUNT_SETTINGS_CHANGED_CHANNEL,
      AccountSettingsReply,
      listener
    ),
  updateAccountSettings: (request) =>
    ipcRenderer.invoke(SETTINGS_UPDATE_ACCOUNT_SETTINGS_CHANNEL, request),
};
