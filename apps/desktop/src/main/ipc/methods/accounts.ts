import * as Schema from "effect/Schema";

import { AccountSetupOpenReply } from "../../../shared/ipc/account-setup";
import {
  AccountDisconnectRequest,
  AccountNameUpdateRequest,
  AccountReorderReply,
  AccountReorderRequest,
  AccountSignInRequest,
  AccountsReply,
} from "../../../shared/ipc/accounts";
import {
  ACCOUNTS_DISCONNECT_CHANNEL,
  ACCOUNTS_LIST_CHANNEL,
  ACCOUNTS_OPEN_SETUP_CHANNEL,
  ACCOUNTS_OPEN_SIGN_IN_CHANNEL,
  ACCOUNTS_REORDER_CHANNEL,
  ACCOUNTS_UPDATE_NAME_CHANNEL,
} from "../../../shared/ipc/channels";
import {
  openAccountSetupWindow,
  openAccountSignInWindow,
} from "../../auth/account-setup-window";
import {
  listAccounts as loadAccounts,
  reorderAccounts as saveAccountOrder,
  updateAccountName as saveAccountName,
} from "../../auth/accounts";
import { disconnectAccount as removeAccount } from "../../auth/disconnect-account";
import { makeIpcMethod } from "../desktop-ipc";
import { toIpcReply } from "../reply";

export const listAccounts = makeIpcMethod({
  channel: ACCOUNTS_LIST_CHANNEL,
  handler: () => toIpcReply(loadAccounts(), "Could not load accounts"),
  payload: Schema.Void,
  result: AccountsReply,
});

export const disconnectAccount = makeIpcMethod({
  channel: ACCOUNTS_DISCONNECT_CHANNEL,
  handler: (request) =>
    toIpcReply(
      removeAccount(request.email),
      "Could not disconnect the account"
    ),
  payload: AccountDisconnectRequest,
  result: AccountsReply,
});

export const reorderAccounts = makeIpcMethod({
  channel: ACCOUNTS_REORDER_CHANNEL,
  handler: (request) =>
    toIpcReply(
      saveAccountOrder(request.emails),
      "Could not save account order"
    ),
  payload: AccountReorderRequest,
  result: AccountReorderReply,
});

export const updateAccountName = makeIpcMethod({
  channel: ACCOUNTS_UPDATE_NAME_CHANNEL,
  handler: (request) =>
    toIpcReply(
      saveAccountName(request.email, request.name),
      "Could not save the name"
    ),
  payload: AccountNameUpdateRequest,
  result: AccountsReply,
});

export const openAccountSetup = makeIpcMethod({
  channel: ACCOUNTS_OPEN_SETUP_CHANNEL,
  handler: () =>
    toIpcReply(openAccountSetupWindow(), "Could not open account setup"),
  payload: Schema.Void,
  result: AccountSetupOpenReply,
});

export const openAccountSignIn = makeIpcMethod({
  channel: ACCOUNTS_OPEN_SIGN_IN_CHANNEL,
  handler: (request) =>
    toIpcReply(
      openAccountSignInWindow(request.email),
      "Could not open sign-in"
    ),
  payload: AccountSignInRequest,
  result: AccountSetupOpenReply,
});
