import { ipcRenderer } from "electron";

import { GoogleAccountsReply } from "../shared/ipc/auth";
import type { DesktopBridge } from "../shared/ipc/bridge";
import {
  AUTH_GOOGLE_ACCOUNTS_CHANGED_CHANNEL,
  AUTH_GOOGLE_DISCONNECT_ACCOUNT_CHANNEL,
  AUTH_GOOGLE_LIST_ACCOUNTS_CHANNEL,
  AUTH_GOOGLE_REORDER_ACCOUNTS_CHANNEL,
  AUTH_GOOGLE_START_CHANNEL,
} from "../shared/ipc/channels";
import { subscribe } from "./subscribe";

export const authApi: Pick<
  DesktopBridge,
  | "disconnectGoogleAccount"
  | "listGoogleAccounts"
  | "onGoogleAccountsChanged"
  | "reorderGoogleAccounts"
  | "startGoogleAuth"
> = {
  disconnectGoogleAccount: (request) =>
    ipcRenderer.invoke(AUTH_GOOGLE_DISCONNECT_ACCOUNT_CHANNEL, request),
  listGoogleAccounts: () =>
    ipcRenderer.invoke(AUTH_GOOGLE_LIST_ACCOUNTS_CHANNEL),
  onGoogleAccountsChanged: (listener) =>
    subscribe(
      AUTH_GOOGLE_ACCOUNTS_CHANGED_CHANNEL,
      GoogleAccountsReply,
      listener
    ),
  reorderGoogleAccounts: (request) =>
    ipcRenderer.invoke(AUTH_GOOGLE_REORDER_ACCOUNTS_CHANNEL, request),
  startGoogleAuth: () => ipcRenderer.invoke(AUTH_GOOGLE_START_CHANNEL),
};
