import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  UPDATES_CHECK_CHANNEL,
  UPDATES_GET_STATUS_CHANNEL,
  UPDATES_INSTALL_CHANNEL,
} from "../../../shared/ipc/channels";
import { UpdateStatus } from "../../../shared/update-status";
import {
  checkForUpdates,
  getUpdateStatus,
  installUpdate,
} from "../../updates/updater";
import { makeIpcMethod } from "../desktop-ipc";

export const getStatus = makeIpcMethod({
  channel: UPDATES_GET_STATUS_CHANNEL,
  handler: () => Effect.sync(getUpdateStatus),
  payload: Schema.Void,
  result: UpdateStatus,
});

export const check = makeIpcMethod({
  channel: UPDATES_CHECK_CHANNEL,
  handler: () => Effect.promise(checkForUpdates),
  payload: Schema.Void,
  result: UpdateStatus,
});

export const install = makeIpcMethod({
  channel: UPDATES_INSTALL_CHANNEL,
  handler: () => Effect.sync(installUpdate),
  payload: Schema.Void,
  result: Schema.Void,
});
