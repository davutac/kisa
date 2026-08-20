import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  LoginItemSettingsReply,
  LoginItemSettingsUpdateRequest,
} from "../../../shared/ipc/app";
import {
  APP_GET_LOGIN_ITEM_SETTINGS_CHANNEL,
  APP_SET_LOGIN_ITEM_SETTINGS_CHANNEL,
} from "../../../shared/ipc/channels";
import {
  readLoginItemSettings,
  updateLoginItemSettings,
} from "../../settings/login-item-settings";
import { makeIpcMethod } from "../desktop-ipc";
import { toIpcReply } from "../reply";

const READ_ERROR_MESSAGE = "Could not read login item settings";
const UPDATE_ERROR_MESSAGE = "Could not update login item settings";

export const getLoginItemSettings = makeIpcMethod({
  channel: APP_GET_LOGIN_ITEM_SETTINGS_CHANNEL,
  handler: () =>
    toIpcReply(
      Effect.try({
        catch: () => READ_ERROR_MESSAGE,
        try: readLoginItemSettings,
      }),
      READ_ERROR_MESSAGE
    ),
  payload: Schema.Void,
  result: LoginItemSettingsReply,
});

export const setLoginItemSettings = makeIpcMethod({
  channel: APP_SET_LOGIN_ITEM_SETTINGS_CHANNEL,
  handler: ({ openAtLogin }) =>
    toIpcReply(
      Effect.try({
        catch: () => UPDATE_ERROR_MESSAGE,
        try: () => updateLoginItemSettings(openAtLogin),
      }),
      UPDATE_ERROR_MESSAGE
    ),
  payload: LoginItemSettingsUpdateRequest,
  result: LoginItemSettingsReply,
});
