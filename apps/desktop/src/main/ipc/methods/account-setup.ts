import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { PasswordAccountSetupReply } from "../../../shared/ipc/account-setup";
import {
  ACCOUNT_SETUP_CLOSE_CHANNEL,
  ACCOUNT_SETUP_SUBMIT_CHANNEL,
} from "../../../shared/ipc/channels";
import {
  closeAccountSetup,
  submitAccountSetup,
} from "../../auth/account-setup-window";
import { makeIpcMethod } from "../desktop-ipc";
import { toIpcReply } from "../reply";

/**
 * The Add account window's sign-in. The payload carries the app password, so
 * it is decoded by the handler, not by `makeIpcMethod`: a failed decode there
 * would reject with an issue that quotes the value, and Electron logs
 * rejections. Every failure here is a fixed message instead.
 */
export const submitPasswordAccount = makeIpcMethod({
  channel: ACCOUNT_SETUP_SUBMIT_CHANNEL,
  handler: (input, event) =>
    toIpcReply(
      submitAccountSetup(event?.sender.id, input),
      "Could not add the account"
    ),
  payload: Schema.Unknown,
  result: PasswordAccountSetupReply,
});

export const closeAccountSetupWindow = makeIpcMethod({
  channel: ACCOUNT_SETUP_CLOSE_CHANNEL,
  handler: (_request, event) =>
    Effect.sync(() => closeAccountSetup(event?.sender.id)),
  payload: Schema.Void,
  result: Schema.Void,
});
