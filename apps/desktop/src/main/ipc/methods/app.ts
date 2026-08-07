import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { AppStartupReply } from "../../../shared/ipc/app";
import { APP_START_CHANNEL } from "../../../shared/ipc/channels";
import { getAppStartupReply } from "../../app/startup";
import { makeIpcMethod } from "../desktop-ipc";

export const startApp = makeIpcMethod({
  channel: APP_START_CHANNEL,
  handler: () => Effect.promise(getAppStartupReply),
  payload: Schema.Void,
  result: AppStartupReply,
});
