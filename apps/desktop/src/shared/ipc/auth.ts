import * as Schema from "effect/Schema";

import { IpcReply } from "./reply";

export const MAX_GOOGLE_ACCOUNTS = 9;

export type GoogleAuthCallback =
  | {
      readonly attempt: string;
      readonly code: string;
      readonly error?: never;
    }
  | {
      readonly attempt: string;
      readonly code?: never;
      readonly error: string;
    };

export const GoogleAccount = Schema.Struct({
  avatarUrl: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  email: Schema.String,
  scopes: Schema.Array(Schema.String),
});
export type GoogleAccount = typeof GoogleAccount.Type;

export const GoogleAccountsReply = IpcReply(Schema.Array(GoogleAccount));
export type GoogleAccountsReply = typeof GoogleAccountsReply.Type;

export const GoogleAccountDisconnectRequest = Schema.Struct({
  email: Schema.NonEmptyString,
});
export type GoogleAccountDisconnectRequest =
  typeof GoogleAccountDisconnectRequest.Type;

export const GoogleAccountReorderRequest = Schema.Struct({
  emails: Schema.Array(Schema.NonEmptyString),
});
export type GoogleAccountReorderRequest =
  typeof GoogleAccountReorderRequest.Type;

export const GoogleAccountReorderReply = IpcReply(Schema.Void);
export type GoogleAccountReorderReply = typeof GoogleAccountReorderReply.Type;

export const GoogleAuthStartReply = IpcReply(Schema.Void);
export type GoogleAuthStartReply = typeof GoogleAuthStartReply.Type;
