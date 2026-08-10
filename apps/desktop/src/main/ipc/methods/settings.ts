import * as Schema from "effect/Schema";

import {
  SETTINGS_BEGIN_DATABASE_IMPORT_CHANNEL,
  SETTINGS_CANCEL_DATABASE_IMPORT_CHANNEL,
  SETTINGS_DROP_DATABASE_IMPORT_FILE_CHANNEL,
  SETTINGS_EXPORT_DATABASE_RECOVERY_KEY_CHANNEL,
  SETTINGS_IMPORT_DATABASE_CHANNEL,
  SETTINGS_LIST_ACCOUNT_SETTINGS_CHANNEL,
  SETTINGS_SELECT_DATABASE_IMPORT_FILE_CHANNEL,
  SETTINGS_UPDATE_ACCOUNT_SETTINGS_CHANNEL,
} from "../../../shared/ipc/channels";
import {
  AccountSettingsReply,
  AccountSettingsUpdateRequest,
  DatabaseImportCancelReply,
  DatabaseImportDroppedFileRequest,
  DatabaseImportFileSelectionReply,
  DatabaseImportFileSelectionRequest,
  DatabaseImportReply,
  DatabaseImportSession,
  DatabaseImportSessionReply,
  DatabaseRecoveryKeyExportReply,
} from "../../../shared/ipc/settings";
import {
  beginDatabaseImport,
  cancelDatabaseImport,
  dropDatabaseImportFile,
  exportDatabaseRecoveryKey,
  importDatabase,
  selectDatabaseImportFile,
} from "../../database";
import {
  listAccountSettings,
  updateAccountSettings,
} from "../../settings/account-settings";
import { makeIpcMethod } from "../desktop-ipc";
import { toIpcReply } from "../reply";

export const listSettings = makeIpcMethod({
  channel: SETTINGS_LIST_ACCOUNT_SETTINGS_CHANNEL,
  handler: () =>
    toIpcReply(listAccountSettings(), "Could not load account settings"),
  payload: Schema.Void,
  result: AccountSettingsReply,
});

export const exportRecoveryKey = makeIpcMethod({
  channel: SETTINGS_EXPORT_DATABASE_RECOVERY_KEY_CHANNEL,
  handler: () =>
    toIpcReply(
      exportDatabaseRecoveryKey(),
      "Could not export the database recovery key"
    ),
  payload: Schema.Void,
  result: DatabaseRecoveryKeyExportReply,
});

export const beginImport = makeIpcMethod({
  channel: SETTINGS_BEGIN_DATABASE_IMPORT_CHANNEL,
  handler: () =>
    toIpcReply(beginDatabaseImport(), "Could not start the database import"),
  payload: Schema.Void,
  result: DatabaseImportSessionReply,
});

export const cancelImport = makeIpcMethod({
  channel: SETTINGS_CANCEL_DATABASE_IMPORT_CHANNEL,
  handler: (request) =>
    toIpcReply(cancelDatabaseImport(request), "Could not cancel the import"),
  payload: DatabaseImportSession,
  result: DatabaseImportCancelReply,
});

export const selectImportFile = makeIpcMethod({
  channel: SETTINGS_SELECT_DATABASE_IMPORT_FILE_CHANNEL,
  handler: (request) =>
    toIpcReply(
      selectDatabaseImportFile(request),
      "Could not select the import file"
    ),
  payload: DatabaseImportFileSelectionRequest,
  result: DatabaseImportFileSelectionReply,
});

export const dropImportFile = makeIpcMethod({
  channel: SETTINGS_DROP_DATABASE_IMPORT_FILE_CHANNEL,
  handler: (request) =>
    toIpcReply(
      dropDatabaseImportFile(request),
      "Could not use the dropped import file"
    ),
  payload: DatabaseImportDroppedFileRequest,
  result: DatabaseImportFileSelectionReply,
});

export const importExistingDatabase = makeIpcMethod({
  channel: SETTINGS_IMPORT_DATABASE_CHANNEL,
  handler: (request) =>
    toIpcReply(importDatabase(request), "Could not import the database"),
  payload: DatabaseImportSession,
  result: DatabaseImportReply,
});

export const updateSettings = makeIpcMethod({
  channel: SETTINGS_UPDATE_ACCOUNT_SETTINGS_CHANNEL,
  handler: (request) =>
    toIpcReply(
      updateAccountSettings(request),
      "Could not save the account settings"
    ),
  payload: AccountSettingsUpdateRequest,
  result: AccountSettingsReply,
});
