import * as Schema from "effect/Schema";

import { MAX_DISPLAY_NAME_LENGTH } from "../mail-account-presets";
import { IpcReply } from "./reply";

/** The sender name outgoing mail carries; control characters would break the header. */
export const DisplayName = Schema.String.check(
  Schema.isMaxLength(MAX_DISPLAY_NAME_LENGTH),
  // oxlint-disable-next-line no-control-regex -- Control characters are what this rejects.
  Schema.isPattern(/^[^\p{Cc}]*$/u)
);

/**
 * Whose mail service an account is on, for display. `imap` is any server
 * Kisa has no preset for.
 */
export const AccountProvider = Schema.Literals([
  "gmail",
  "icloud",
  "imap",
  "outlook",
]);
export type AccountProvider = typeof AccountProvider.Type;

/** A connected mail account as the renderer sees it: never its sign-in. */
export const Account = Schema.Struct({
  displayName: Schema.optional(Schema.String),
  email: Schema.String,
  provider: AccountProvider,
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

/** A new sender name for a connected account; blank sends with the bare address. */
export const AccountNameUpdateRequest = Schema.Struct({
  email: Schema.NonEmptyString,
  name: DisplayName,
});
export type AccountNameUpdateRequest = typeof AccountNameUpdateRequest.Type;

export const AccountReorderRequest = Schema.Struct({
  emails: Schema.Array(Schema.NonEmptyString),
});
export type AccountReorderRequest = typeof AccountReorderRequest.Type;

export const AccountReorderReply = IpcReply(Schema.Void);
export type AccountReorderReply = typeof AccountReorderReply.Type;
