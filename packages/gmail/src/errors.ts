// oxlint-disable eslint/max-classes-per-file unicorn/throw-new-error
import { Schema } from "effect";

import { AccountId } from "./models";

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export class InvalidAuthHandoffError extends Schema.TaggedErrorClass<InvalidAuthHandoffError>()(
  "InvalidAuthHandoffError",
  { message: Schema.String }
) {}

export class AccountNotFoundError extends Schema.TaggedErrorClass<AccountNotFoundError>()(
  "AccountNotFoundError",
  { accountId: AccountId, message: Schema.String }
) {}

export class GmailPermissionError extends Schema.TaggedErrorClass<GmailPermissionError>()(
  "GmailPermissionError",
  {
    accountId: AccountId,
    capability: Schema.Literals(["modify", "read", "send"]),
    message: Schema.String,
  }
) {}

export class GmailReauthorizationRequiredError extends Schema.TaggedErrorClass<GmailReauthorizationRequiredError>()(
  "GmailReauthorizationRequiredError",
  { accountId: AccountId, message: Schema.String }
) {}

export class GmailApiError extends Schema.TaggedErrorClass<GmailApiError>()(
  "GmailApiError",
  {
    accountId: Schema.optional(AccountId),
    cause: Schema.optional(Schema.Defect()),
    message: Schema.String,
    retryable: Schema.Boolean,
  }
) {}

export class GmailRateLimitError extends Schema.TaggedErrorClass<GmailRateLimitError>()(
  "GmailRateLimitError",
  {
    accountId: AccountId,
    message: Schema.String,
    retryAfterMs: Schema.optional(NonNegativeInt),
  }
) {}

export class GmailMimeError extends Schema.TaggedErrorClass<GmailMimeError>()(
  "GmailMimeError",
  { cause: Schema.optional(Schema.Defect()), message: Schema.String }
) {}

export class GmailValidationError extends Schema.TaggedErrorClass<GmailValidationError>()(
  "GmailValidationError",
  { message: Schema.String }
) {}

export class GmailSendOutcomeUnknownError extends Schema.TaggedErrorClass<GmailSendOutcomeUnknownError>()(
  "GmailSendOutcomeUnknownError",
  {
    accountId: AccountId,
    message: Schema.String,
  }
) {}

export class GmailStoreError extends Schema.TaggedErrorClass<GmailStoreError>()(
  "GmailStoreError",
  { cause: Schema.optional(Schema.Defect()), message: Schema.String }
) {}

export class GmailHistoryExpiredError extends Schema.TaggedErrorClass<GmailHistoryExpiredError>()(
  "GmailHistoryExpiredError",
  { accountId: AccountId, message: Schema.String }
) {}

export type GmailError =
  | AccountNotFoundError
  | GmailApiError
  | GmailHistoryExpiredError
  | GmailMimeError
  | GmailPermissionError
  | GmailRateLimitError
  | GmailReauthorizationRequiredError
  | GmailSendOutcomeUnknownError
  | GmailStoreError
  | GmailValidationError
  | InvalidAuthHandoffError;
