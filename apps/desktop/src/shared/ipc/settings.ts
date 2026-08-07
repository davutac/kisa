import * as Schema from "effect/Schema";

import { IpcReply } from "./reply";

export const AccountSettings = Schema.Struct({
  accountId: Schema.String,
  /** Gmail's own labels (INBOX, UNREAD, CATEGORY_*, …) shown next to threads. */
  showSystemLabels: Schema.Boolean,
});
export type AccountSettings = typeof AccountSettings.Type;

/** Accounts without a stored row behave as if they had these settings. */
export const DEFAULT_ACCOUNT_SETTINGS = {
  showSystemLabels: true,
} as const satisfies Omit<AccountSettings, "accountId">;

export const AccountSettingsUpdateRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  showSystemLabels: Schema.Boolean,
});
export type AccountSettingsUpdateRequest =
  typeof AccountSettingsUpdateRequest.Type;

export const AccountSettingsReply = IpcReply(Schema.Array(AccountSettings));
export type AccountSettingsReply = typeof AccountSettingsReply.Type;
