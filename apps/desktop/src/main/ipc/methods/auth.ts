import * as Schema from "effect/Schema";

import {
  GoogleAccountDisconnectRequest,
  GoogleAccountsReply,
  GoogleAuthStartReply,
} from "../../../shared/ipc/auth";
import {
  AUTH_GOOGLE_DISCONNECT_ACCOUNT_CHANNEL,
  AUTH_GOOGLE_LIST_ACCOUNTS_CHANNEL,
  AUTH_GOOGLE_START_CHANNEL,
} from "../../../shared/ipc/channels";
import { listGoogleAccounts, startGoogleAuth } from "../../auth/auth";
import { disconnectGoogleAccount } from "../../auth/disconnect-account";
import { makeIpcMethod } from "../desktop-ipc";
import { toIpcReply } from "../reply";

export const startGoogle = makeIpcMethod({
  channel: AUTH_GOOGLE_START_CHANNEL,
  handler: () => toIpcReply(startGoogleAuth(), "Google authentication failed"),
  payload: Schema.Void,
  result: GoogleAuthStartReply,
});

export const listAccounts = makeIpcMethod({
  channel: AUTH_GOOGLE_LIST_ACCOUNTS_CHANNEL,
  handler: () =>
    toIpcReply(listGoogleAccounts(), "Could not load Google accounts"),
  payload: Schema.Void,
  result: GoogleAccountsReply,
});

export const disconnectAccount = makeIpcMethod({
  channel: AUTH_GOOGLE_DISCONNECT_ACCOUNT_CHANNEL,
  handler: (request) =>
    toIpcReply(
      disconnectGoogleAccount(request.email),
      "Could not disconnect the Google account"
    ),
  payload: GoogleAccountDisconnectRequest,
  result: GoogleAccountsReply,
});
