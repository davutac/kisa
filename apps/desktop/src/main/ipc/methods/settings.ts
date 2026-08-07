import * as Schema from "effect/Schema";

import {
  SETTINGS_LIST_ACCOUNT_SETTINGS_CHANNEL,
  SETTINGS_UPDATE_ACCOUNT_SETTINGS_CHANNEL,
} from "../../../shared/ipc/channels";
import {
  AccountSettingsReply,
  AccountSettingsUpdateRequest,
} from "../../../shared/ipc/settings";
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
