import * as Schema from "effect/Schema";

import { IpcReply } from "./reply";

export const AccountSettings = Schema.Struct({
  accountId: Schema.String,
  /** Whether newly synced unread Inbox messages may produce an OS alert. */
  notificationsEnabled: Schema.Boolean,
  /** Gmail's own labels (INBOX, UNREAD, CATEGORY_*, …) shown next to threads. */
  showSystemLabels: Schema.Boolean,
});
export type AccountSettings = typeof AccountSettings.Type;

/** Accounts without a stored row behave as if they had these settings. */
export const DEFAULT_ACCOUNT_SETTINGS = {
  notificationsEnabled: true,
  showSystemLabels: true,
} as const satisfies Omit<AccountSettings, "accountId">;

export const AccountSettingsUpdateRequest = Schema.Union([
  Schema.Struct({
    accountId: Schema.NonEmptyString,
    notificationsEnabled: Schema.Boolean,
  }),
  Schema.Struct({
    accountId: Schema.NonEmptyString,
    showSystemLabels: Schema.Boolean,
  }),
]);
export type AccountSettingsUpdateRequest =
  typeof AccountSettingsUpdateRequest.Type;

export const AccountSettingsReply = IpcReply(Schema.Array(AccountSettings));
export type AccountSettingsReply = typeof AccountSettingsReply.Type;

export const DatabaseRecoveryKeyExportOutcome = Schema.Literals([
  "cancelled",
  "saved",
]);
export type DatabaseRecoveryKeyExportOutcome =
  typeof DatabaseRecoveryKeyExportOutcome.Type;

export const DatabaseRecoveryKeyExportReply = IpcReply(
  DatabaseRecoveryKeyExportOutcome
);
export type DatabaseRecoveryKeyExportReply =
  typeof DatabaseRecoveryKeyExportReply.Type;

export const DatabaseImportOutcome = Schema.Literal("restart-pending");
export type DatabaseImportOutcome = typeof DatabaseImportOutcome.Type;

export const DatabaseImportReply = IpcReply(DatabaseImportOutcome);
export type DatabaseImportReply = typeof DatabaseImportReply.Type;

export const DatabaseImportSession = Schema.Struct({
  sessionId: Schema.NonEmptyString,
});
export type DatabaseImportSession = typeof DatabaseImportSession.Type;

export const DatabaseImportSessionReply = IpcReply(DatabaseImportSession);
export type DatabaseImportSessionReply = typeof DatabaseImportSessionReply.Type;

export const DatabaseImportFileKind = Schema.Literals([
  "database",
  "recovery-key",
]);
export type DatabaseImportFileKind = typeof DatabaseImportFileKind.Type;

export const DatabaseImportFileSelectionRequest = Schema.Struct({
  kind: DatabaseImportFileKind,
  sessionId: Schema.NonEmptyString,
});
export type DatabaseImportFileSelectionRequest =
  typeof DatabaseImportFileSelectionRequest.Type;

export const DatabaseImportDroppedFileRequest = Schema.Struct({
  filePath: Schema.NonEmptyString,
  kind: DatabaseImportFileKind,
  sessionId: Schema.NonEmptyString,
});
export type DatabaseImportDroppedFileRequest =
  typeof DatabaseImportDroppedFileRequest.Type;

export const DatabaseImportFileSelection = Schema.Struct({
  fileName: Schema.NonEmptyString,
});
export type DatabaseImportFileSelection =
  typeof DatabaseImportFileSelection.Type;

export const DatabaseImportFileSelectionReply = IpcReply(
  Schema.NullOr(DatabaseImportFileSelection)
);
export type DatabaseImportFileSelectionReply =
  typeof DatabaseImportFileSelectionReply.Type;

export const DatabaseImportCancelReply = IpcReply(Schema.Void);
export type DatabaseImportCancelReply = typeof DatabaseImportCancelReply.Type;

export const DatabaseImportProgress = Schema.Literals([
  "copying",
  "validating",
  "preparing",
  "ready",
]);
export type DatabaseImportProgress = typeof DatabaseImportProgress.Type;
