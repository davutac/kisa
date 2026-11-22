import { ipcRenderer } from "electron";

import { AccountsReply } from "../shared/ipc/accounts";
import type { DesktopBridge } from "../shared/ipc/bridge";
import {
  ACCOUNTS_CHANGED_CHANNEL,
  ACCOUNTS_DISCONNECT_CHANNEL,
  ACCOUNTS_LIST_CHANNEL,
  ACCOUNTS_OPEN_SETUP_CHANNEL,
  ACCOUNTS_OPEN_SIGN_IN_CHANNEL,
  ACCOUNTS_REORDER_CHANNEL,
} from "../shared/ipc/channels";
import { subscribe } from "./subscribe";

export const accountsApi: Pick<
  DesktopBridge,
  | "disconnectAccount"
  | "listAccounts"
  | "onAccountsChanged"
  | "openAccountSetup"
  | "openAccountSignIn"
  | "reorderAccounts"
> = {
  disconnectAccount: (request) =>
    ipcRenderer.invoke(ACCOUNTS_DISCONNECT_CHANNEL, request),
  listAccounts: () => ipcRenderer.invoke(ACCOUNTS_LIST_CHANNEL),
  onAccountsChanged: (listener) =>
    subscribe(ACCOUNTS_CHANGED_CHANNEL, AccountsReply, listener),
  openAccountSetup: () => ipcRenderer.invoke(ACCOUNTS_OPEN_SETUP_CHANNEL),
  openAccountSignIn: (request) =>
    ipcRenderer.invoke(ACCOUNTS_OPEN_SIGN_IN_CHANNEL, request),
  reorderAccounts: (request) =>
    ipcRenderer.invoke(ACCOUNTS_REORDER_CHANNEL, request),
};
