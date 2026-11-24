// oxlint-disable eslint/max-classes-per-file unicorn/throw-new-error
import { Schema } from "effect";

import { AccountId } from "./ids";

/** The server refused the account's credentials: the user has to sign in again. */
export class MailAuthError extends Schema.TaggedError<
  MailAuthError,
  { readonly brand: unique symbol }
>()("MailAuthError", { accountId: AccountId, message: Schema.String }) {}

/** The connection failed or dropped. Worth retrying after a pause. */
export class MailConnectionError extends Schema.TaggedError<
  MailConnectionError,
  { readonly brand: unique symbol }
>()("MailConnectionError", {
  accountId: AccountId,
  cause: Schema.optional(Schema.Defect()),
  message: Schema.String,
}) {}

/** The server asked Kisa to slow down. */
export class MailThrottledError extends Schema.TaggedError<
  MailThrottledError,
  { readonly brand: unique symbol }
>()("MailThrottledError", {
  accountId: AccountId,
  message: Schema.String,
  retryAfterMs: Schema.optional(Schema.Natural),
}) {}

/** The server refused a command or answered with something unreadable. */
export class MailProtocolError extends Schema.TaggedError<
  MailProtocolError,
  { readonly brand: unique symbol }
>()("MailProtocolError", {
  accountId: AccountId,
  cause: Schema.optional(Schema.Defect()),
  message: Schema.String,
}) {}

/** A mailbox named by the cache no longer exists on the server. */
export class MailboxMissingError extends Schema.TaggedError<
  MailboxMissingError,
  { readonly brand: unique symbol }
>()("MailboxMissingError", { accountId: AccountId, path: Schema.String }) {}

/** The server refused the message or every recipient: nothing was sent. */
export class MailSendRejectedError extends Schema.TaggedError<
  MailSendRejectedError,
  { readonly brand: unique symbol }
>()("MailSendRejectedError", {
  accountId: AccountId,
  message: Schema.String,
}) {}

/**
 * The connection ended after the message was handed over and before the
 * server answered, so it may have been sent. Never retried automatically:
 * the user decides, or the message is looked for in sent mail.
 */
export class MailSendUnknownError extends Schema.TaggedError<
  MailSendUnknownError,
  { readonly brand: unique symbol }
>()("MailSendUnknownError", { accountId: AccountId, message: Schema.String }) {}

/** The local cache could not be read or written. */
export class MailStoreError extends Schema.TaggedError<
  MailStoreError,
  { readonly brand: unique symbol }
>()("MailStoreError", {
  cause: Schema.optional(Schema.Defect()),
  message: Schema.String,
}) {}

export type MailTransportError =
  | MailAuthError
  | MailConnectionError
  | MailProtocolError
  | MailThrottledError
  | MailboxMissingError;

export const isRetryableTransportError = (error: MailTransportError): boolean =>
  error._tag === "MailConnectionError" || error._tag === "MailThrottledError";
