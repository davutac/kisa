import * as Schema from "effect/Schema";

import { IpcReply } from "./reply";

/** A connected mail account as the renderer sees it: never its sign-in. */
export const Account = Schema.Struct({
  displayName: Schema.optional(Schema.String),
  email: Schema.String,
});
export type Account = typeof Account.Type;

export const AccountsReply = IpcReply(Schema.Array(Account));
export type AccountsReply = typeof AccountsReply.Type;

export const AccountDisconnectRequest = Schema.Struct({
  email: Schema.NonEmptyString,
});
export type AccountDisconnectRequest = typeof AccountDisconnectRequest.Type;

/** Which connected account to sign in again; how is main's to decide. */
export const AccountSignInRequest = Schema.Struct({
  email: Schema.NonEmptyString,
});
export type AccountSignInRequest = typeof AccountSignInRequest.Type;

export const AccountReorderRequest = Schema.Struct({
  emails: Schema.Array(Schema.NonEmptyString),
});
export type AccountReorderRequest = typeof AccountReorderRequest.Type;

export const AccountReorderReply = IpcReply(Schema.Void);
export type AccountReorderReply = typeof AccountReorderReply.Type;
