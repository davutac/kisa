import { ipcRenderer, webUtils } from "electron";

import type { DesktopBridge } from "../shared/ipc/bridge";
import {
  SETTINGS_ACCOUNT_SETTINGS_CHANGED_CHANNEL,
  SETTINGS_BEGIN_DATABASE_IMPORT_CHANNEL,
  SETTINGS_CANCEL_DATABASE_IMPORT_CHANNEL,
  SETTINGS_DATABASE_IMPORT_PROGRESS_CHANNEL,
  SETTINGS_DATABASE_IMPORT_STATUS_CHANNEL,
  SETTINGS_DISCARD_DATABASE_IMPORT_CHANNEL,
  SETTINGS_DROP_DATABASE_IMPORT_FILE_CHANNEL,
  SETTINGS_EXPORT_DATABASE_RECOVERY_KEY_CHANNEL,
  SETTINGS_IMPORT_DATABASE_CHANNEL,
  SETTINGS_LIST_ACCOUNT_SETTINGS_CHANNEL,
  SETTINGS_RESTART_FOR_DATABASE_IMPORT_CHANNEL,
  SETTINGS_SELECT_DATABASE_IMPORT_FILE_CHANNEL,
  SETTINGS_UPDATE_ACCOUNT_SETTINGS_CHANNEL,
} from "../shared/ipc/channels";
import {
  AccountSettingsReply,
  DatabaseImportProgress,
} from "../shared/ipc/settings";
import { subscribe } from "./subscribe";

export const settingsApi: Pick<
  DesktopBridge,
  | "beginDatabaseImport"
  | "cancelDatabaseImport"
  | "discardDatabaseImport"
  | "dropDatabaseImportFile"
  | "exportDatabaseRecoveryKey"
  | "getDatabaseImportStatus"
  | "importDatabase"
  | "listAccountSettings"
  | "onAccountSettingsChanged"
  | "onDatabaseImportProgress"
  | "restartForDatabaseImport"
  | "selectDatabaseImportFile"
  | "updateAccountSettings"
> = {
  beginDatabaseImport: () =>
    ipcRenderer.invoke(SETTINGS_BEGIN_DATABASE_IMPORT_CHANNEL),
  cancelDatabaseImport: (request) =>
    ipcRenderer.invoke(SETTINGS_CANCEL_DATABASE_IMPORT_CHANNEL, request),
  discardDatabaseImport: () =>
    ipcRenderer.invoke(SETTINGS_DISCARD_DATABASE_IMPORT_CHANNEL),
  dropDatabaseImportFile: ({ file, kind, sessionId }) =>
    ipcRenderer.invoke(SETTINGS_DROP_DATABASE_IMPORT_FILE_CHANNEL, {
      filePath: webUtils.getPathForFile(file),
      kind,
      sessionId,
    }),
  exportDatabaseRecoveryKey: () =>
    ipcRenderer.invoke(SETTINGS_EXPORT_DATABASE_RECOVERY_KEY_CHANNEL),
  getDatabaseImportStatus: () =>
    ipcRenderer.invoke(SETTINGS_DATABASE_IMPORT_STATUS_CHANNEL),
  importDatabase: (request) =>
    ipcRenderer.invoke(SETTINGS_IMPORT_DATABASE_CHANNEL, request),
  listAccountSettings: () =>
    ipcRenderer.invoke(SETTINGS_LIST_ACCOUNT_SETTINGS_CHANNEL),
  onAccountSettingsChanged: (listener) =>
    subscribe(
      SETTINGS_ACCOUNT_SETTINGS_CHANGED_CHANNEL,
      AccountSettingsReply,
      listener
    ),
  onDatabaseImportProgress: (listener) =>
    subscribe(
      SETTINGS_DATABASE_IMPORT_PROGRESS_CHANNEL,
      DatabaseImportProgress,
      listener
    ),
  restartForDatabaseImport: () =>
    ipcRenderer.invoke(SETTINGS_RESTART_FOR_DATABASE_IMPORT_CHANNEL),
  selectDatabaseImportFile: (request) =>
    ipcRenderer.invoke(SETTINGS_SELECT_DATABASE_IMPORT_FILE_CHANNEL, request),
  updateAccountSettings: (request) =>
    ipcRenderer.invoke(SETTINGS_UPDATE_ACCOUNT_SETTINGS_CHANNEL, request),
};
