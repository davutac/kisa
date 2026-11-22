import * as Schema from "effect/Schema";

import { AccountSetupOpenReply } from "../../../shared/ipc/account-setup";
import {
  AccountDisconnectRequest,
  AccountReorderReply,
  AccountReorderRequest,
  AccountsReply,
} from "../../../shared/ipc/accounts";
import {
  ACCOUNTS_DISCONNECT_CHANNEL,
  ACCOUNTS_LIST_CHANNEL,
  ACCOUNTS_OPEN_SETUP_CHANNEL,
  ACCOUNTS_REORDER_CHANNEL,
} from "../../../shared/ipc/channels";
import { openAccountSetupWindow } from "../../auth/account-setup-window";
import {
  listAccounts as loadAccounts,
  reorderAccounts as saveAccountOrder,
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

export const openAccountSetup = makeIpcMethod({
  channel: ACCOUNTS_OPEN_SETUP_CHANNEL,
  handler: () =>
    toIpcReply(openAccountSetupWindow(), "Could not open account setup"),
  payload: Schema.Void,
  result: AccountSetupOpenReply,
});
