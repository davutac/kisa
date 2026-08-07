import { googleAccounts } from "@repo/database/schemas";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";

import { getDatabaseClient } from "../database";
import { forgetAccountMailData } from "../mail/mail-sync";
import { forgetTrustedImageSenders } from "../mail/trusted-image-senders";
import { forgetAccountSettings } from "../settings/account-settings";
import {
  listGoogleAccounts,
  notifyGoogleAccountsChanged,
  revokeGoogleAccountAccess,
} from "./auth";

// oxlint-disable-next-line unicorn/throw-new-error
class GoogleAccountDisconnectError extends Schema.TaggedErrorClass<GoogleAccountDisconnectError>()(
  "GoogleAccountDisconnectError",
  { message: Schema.String }
) {}

const deleteAccountRecord = Effect.fn("deleteAccountRecord")(
  function* deleteAccountRecord(email: string) {
    const database = yield* getDatabaseClient().pipe(
      Effect.mapError(
        (error) => new GoogleAccountDisconnectError({ message: error.message })
      )
    );

    yield* Effect.try({
      catch: () =>
        new GoogleAccountDisconnectError({
          message: "Could not remove the Google account",
        }),
      try: () =>
        database
          .delete(googleAccounts)
          .where(eq(googleAccounts.email, email))
          .run(),
    });
  }
);

// The stored account goes first: a sync that is still in flight loses its
// credentials before the cached mail is deleted, so it cannot write rows back.
export const disconnectGoogleAccount = Effect.fn("disconnectGoogleAccount")(
  function* disconnectGoogleAccount(email: string) {
    yield* revokeGoogleAccountAccess(email);
    yield* deleteAccountRecord(email);
    yield* forgetAccountMailData(email).pipe(
      Effect.mapError(
        (error) => new GoogleAccountDisconnectError({ message: error.message })
      )
    );
    yield* forgetAccountSettings(email).pipe(
      Effect.mapError(
        (error) => new GoogleAccountDisconnectError({ message: error.message })
      )
    );
    yield* forgetTrustedImageSenders(email).pipe(
      Effect.mapError(
        (error) => new GoogleAccountDisconnectError({ message: error.message })
      )
    );

    const accounts = yield* listGoogleAccounts().pipe(
      Effect.mapError(
        (error) => new GoogleAccountDisconnectError({ message: error.message })
      )
    );

    notifyGoogleAccountsChanged({ data: accounts, ok: true });

    return accounts;
  }
);
