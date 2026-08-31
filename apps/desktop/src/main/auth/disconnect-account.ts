import { googleAccounts } from "@repo/database/schemas";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";

import { cancelThreadCategorization } from "../ai/thread-categorization";
import { withDatabaseClient } from "../database";
import { accountMailWorkSupervisor } from "../mail/account-mail-work-supervisor";
import { cancelMailBackfill } from "../mail/mail-backfill";
import { forgetAccountDrafts } from "../mail/mail-drafts";
import { forgetAccountMailData } from "../mail/mail-sync";
import { forgetAccountScheduledMail } from "../mail/scheduled-mail";
import { forgetTrustedImageSenders } from "../mail/trusted-image-senders";
import { forgetAccountSettings } from "../settings/account-settings";
import { notifyComposerTemplatesChanged } from "../templates/composer-templates";
import {
  listGoogleAccounts,
  notifyGoogleAccountsChanged,
  revokeGoogleAccountAccess,
} from "./auth";

// oxlint-disable-next-line unicorn/throw-new-error
class GoogleAccountDisconnectError extends Schema.TaggedError<GoogleAccountDisconnectError>()(
  "GoogleAccountDisconnectError",
  { message: Schema.String }
) {}

const toDisconnectError = (error: { readonly message: string }) =>
  new GoogleAccountDisconnectError({ message: error.message });

const deleteAccountRecord = Effect.fn("deleteAccountRecord")(
  function* deleteAccountRecord(email: string) {
    yield* withDatabaseClient((database) =>
      database
        .delete(googleAccounts)
        .where(eq(googleAccounts.email, email))
        .run()
    ).pipe(
      Effect.mapError(
        () =>
          new GoogleAccountDisconnectError({
            message: "Could not remove the Google account",
          })
      )
    );
  }
);

export const disconnectGoogleAccount = Effect.fn("disconnectGoogleAccount")(
  function* disconnectGoogleAccount(email: string) {
    // Prevent another poll or index run from starting, then wait until
    // every already-authorized writer has stopped before deleting local data.
    cancelMailBackfill(email);
    cancelThreadCategorization(email);
    return yield* Effect.acquireUseRelease(
      accountMailWorkSupervisor.suspend(email),
      () =>
        Effect.gen(function* disconnectSuspendedAccount() {
          yield* revokeGoogleAccountAccess(email);
          yield* deleteAccountRecord(email);
          yield* forgetAccountMailData(email).pipe(
            Effect.mapError(toDisconnectError)
          );
          yield* forgetAccountScheduledMail(email).pipe(
            Effect.mapError(toDisconnectError)
          );
          yield* forgetAccountSettings(email).pipe(
            Effect.mapError(toDisconnectError)
          );
          yield* forgetAccountDrafts(email).pipe(
            Effect.mapError(toDisconnectError)
          );
          yield* forgetTrustedImageSenders(email).pipe(
            Effect.mapError(toDisconnectError)
          );
          yield* notifyComposerTemplatesChanged().pipe(
            Effect.mapError(toDisconnectError)
          );

          const accounts = yield* listGoogleAccounts().pipe(
            Effect.mapError(toDisconnectError)
          );
          notifyGoogleAccountsChanged({ data: accounts, ok: true });
          return accounts;
        }),
      () =>
        Effect.sync(() => {
          accountMailWorkSupervisor.resume(email);
        })
    );
  }
);
