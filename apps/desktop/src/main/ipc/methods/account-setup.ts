import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  MicrosoftAccountSetupReply,
  PasswordAccountSetupReply,
} from "../../../shared/ipc/account-setup";
import {
  ACCOUNT_SETUP_CLOSE_CHANNEL,
  ACCOUNT_SETUP_MICROSOFT_CANCEL_CHANNEL,
  ACCOUNT_SETUP_MICROSOFT_CHANNEL,
  ACCOUNT_SETUP_SUBMIT_CHANNEL,
} from "../../../shared/ipc/channels";
import {
  cancelMicrosoftAccountSetup,
  closeAccountSetup,
  startMicrosoftAccountSetup,
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

/**
 * The Add account window's Microsoft sign-in. The payload carries an address
 * and no credential, but it is decoded by the handler like the password
 * sign-in, so every failure reaches the window as a fixed message.
 */
export const signInMicrosoftAccount = makeIpcMethod({
  channel: ACCOUNT_SETUP_MICROSOFT_CHANNEL,
  handler: (input, event) =>
    toIpcReply(
      startMicrosoftAccountSetup(event?.sender.id, input),
      "Could not add the account"
    ),
  payload: Schema.Unknown,
  result: MicrosoftAccountSetupReply,
});

export const cancelMicrosoftAccountSignIn = makeIpcMethod({
  channel: ACCOUNT_SETUP_MICROSOFT_CANCEL_CHANNEL,
  handler: (_request, event) =>
    Effect.sync(() => cancelMicrosoftAccountSetup(event?.sender.id)),
  payload: Schema.Void,
  result: Schema.Void,
});

export const closeAccountSetupWindow = makeIpcMethod({
  channel: ACCOUNT_SETUP_CLOSE_CHANNEL,
  handler: (_request, event) =>
    Effect.sync(() => closeAccountSetup(event?.sender.id)),
  payload: Schema.Void,
  result: Schema.Void,
});
