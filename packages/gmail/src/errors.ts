// oxlint-disable eslint/max-classes-per-file unicorn/throw-new-error
import { Schema } from "effect";

import { AccountId } from "./models";

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export class InvalidAuthHandoffError extends Schema.TaggedError<InvalidAuthHandoffError>()(
  "InvalidAuthHandoffError",
  { message: Schema.String }
) {}

export class AccountNotFoundError extends Schema.TaggedError<AccountNotFoundError>()(
  "AccountNotFoundError",
  { accountId: AccountId, message: Schema.String }
) {}

export class GmailPermissionError extends Schema.TaggedError<GmailPermissionError>()(
  "GmailPermissionError",
  {
    accountId: AccountId,
    capability: Schema.Literals(["modify", "read", "send"]),
    message: Schema.String,
  }
) {}

export class GmailReauthorizationRequiredError extends Schema.TaggedError<GmailReauthorizationRequiredError>()(
  "GmailReauthorizationRequiredError",
  { accountId: AccountId, message: Schema.String }
) {}

export class GmailApiError extends Schema.TaggedError<GmailApiError>()(
  "GmailApiError",
  {
    accountId: Schema.optional(AccountId),
    cause: Schema.optional(Schema.Defect()),
    message: Schema.String,
    retryable: Schema.Boolean,
  }
) {}

export class GmailRateLimitError extends Schema.TaggedError<GmailRateLimitError>()(
  "GmailRateLimitError",
  {
    accountId: AccountId,
    message: Schema.String,
    retryAfterMs: Schema.optional(NonNegativeInt),
  }
) {}

export class GmailMimeError extends Schema.TaggedError<GmailMimeError>()(
  "GmailMimeError",
  { cause: Schema.optional(Schema.Defect()), message: Schema.String }
) {}

export class GmailValidationError extends Schema.TaggedError<GmailValidationError>()(
  "GmailValidationError",
  { message: Schema.String }
) {}

export class GmailSendOutcomeUnknownError extends Schema.TaggedError<GmailSendOutcomeUnknownError>()(
  "GmailSendOutcomeUnknownError",
  {
    accountId: AccountId,
    message: Schema.String,
  }
) {}

export class GmailStoreError extends Schema.TaggedError<GmailStoreError>()(
  "GmailStoreError",
  { cause: Schema.optional(Schema.Defect()), message: Schema.String }
) {}

export class GmailHistoryExpiredError extends Schema.TaggedError<GmailHistoryExpiredError>()(
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
