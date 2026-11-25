import { mailAccounts } from "@repo/database/schemas";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";

import { cancelThreadCategorization } from "../ai/thread-categorization";
import { withDatabaseClient } from "../database";
import { accountMailWorkSupervisor } from "../mail/account-mail-work-supervisor";
import { forgetAccountSignIn } from "../mail/engine/account-credentials";
import { forgetMailEngineAccount } from "../mail/engine/mail-engine";
import { forgetAccountDrafts } from "../mail/mail-drafts";
import { forgetAccountScheduledMail } from "../mail/scheduled-mail";
import { forgetTrustedImageSenders } from "../mail/trusted-image-senders";
import { forgetAccountSettings } from "../settings/account-settings";
import { notifyComposerTemplatesChanged } from "../templates/composer-templates";
import { listAccounts, notifyAccountsChanged } from "./accounts";

// oxlint-disable-next-line unicorn/throw-new-error
class AccountDisconnectError extends Schema.TaggedError<
  AccountDisconnectError,
  { readonly brand: unique symbol }
>()("AccountDisconnectError", { message: Schema.String }) {}

const toDisconnectError = (error: { readonly message: string }) =>
  new AccountDisconnectError({ message: error.message });

const deleteAccountRecord = Effect.fn("deleteAccountRecord")(
  function* deleteAccountRecord(email: string) {
    yield* withDatabaseClient((database) =>
      database
        .delete(mailAccounts)
        .where(eq(mailAccounts.accountId, email.toLowerCase()))
        .run()
    ).pipe(
      Effect.mapError(
        () =>
          new AccountDisconnectError({
            message: "Could not remove the account",
          })
      )
    );
  }
);

/**
 * Removes an account and everything Kisa keeps for it. Nothing is revoked
 * remotely: the user revokes the app password, or Kisa's access to a
 * Microsoft account, in their provider's settings.
 */
export const disconnectAccount = Effect.fn("disconnectAccount")(
  function* disconnectAccount(email: string) {
    // Prevent another poll or index run from starting, then wait until
    // every already-authorized writer has stopped before deleting local data.
    cancelThreadCategorization(email);
    return yield* Effect.acquireUseRelease(
      accountMailWorkSupervisor.suspend(email),
      () =>
        Effect.gen(function* disconnectSuspendedAccount() {
          yield* deleteAccountRecord(email);
          forgetAccountSignIn(email.toLowerCase());
          yield* forgetMailEngineAccount(email).pipe(
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

          const accounts = yield* listAccounts().pipe(
            Effect.mapError(toDisconnectError)
          );
          notifyAccountsChanged({ data: accounts, ok: true });
          return accounts;
        }),
      () =>
        Effect.sync(() => {
          accountMailWorkSupervisor.resume(email);
        })
    );
  }
);
