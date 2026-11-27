import * as Effect from "effect/Effect";

import { AppThemeReply, AppThemeRequest } from "../../../shared/ipc/app";
import { APP_SET_THEME_CHANNEL } from "../../../shared/ipc/channels";
import { setNativeTheme } from "../../window/native-theme";
import { makeIpcMethod } from "../desktop-ipc";
import { toIpcReply } from "../reply";

const THEME_ERROR_MESSAGE = "Could not apply the theme";

export const setAppTheme = makeIpcMethod({
  channel: APP_SET_THEME_CHANNEL,
  handler: ({ theme }) =>
    toIpcReply(
      Effect.try({
        catch: () => THEME_ERROR_MESSAGE,
        try: () => setNativeTheme(theme),
      }),
      THEME_ERROR_MESSAGE
    ),
  payload: AppThemeRequest,
  result: AppThemeReply,
});
