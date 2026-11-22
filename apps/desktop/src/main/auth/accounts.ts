import { mailAccounts } from "@repo/database/schemas";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";

import type { Account } from "../../shared/ipc/accounts";
import { AccountsReply } from "../../shared/ipc/accounts";
import { ACCOUNTS_CHANGED_CHANNEL } from "../../shared/ipc/channels";
import { withDatabaseClient } from "../database-query";
import { sendRendererEvent } from "../electron/renderer-events";
import { requireSecureCredentialStorage } from "./credential-storage";

// oxlint-disable-next-line unicorn/throw-new-error
export class AccountsError extends Schema.TaggedError<AccountsError>()(
  "AccountsError",
  { message: Schema.String }
) {}

export const notifyAccountsChanged = (reply: AccountsReply): void => {
  sendRendererEvent(ACCOUNTS_CHANGED_CHANNEL, AccountsReply, reply);
};

/**
 * Every connected account in the user's order. Listing fails while secure
 * credential storage is unavailable, since no account could sign in then.
 */
export const listAccounts = Effect.fn("listAccounts")(function* listAccounts() {
  yield* requireSecureCredentialStorage.pipe(
    Effect.mapError(({ message }) => new AccountsError({ message }))
  );
  const rows = yield* withDatabaseClient((database) =>
    database.query.mailAccounts.findMany({
      columns: { displayName: true, email: true },
      // SQL ordering follows insertion order, so these keys are semantic.
      // oxlint-disable-next-line eslint/sort-keys
      orderBy: { sortOrder: "asc", createdAt: "asc", accountId: "asc" },
    })
  ).pipe(
    Effect.mapError(
      () => new AccountsError({ message: "Could not load accounts" })
    )
  );

  return rows.map((row): Account => ({
    displayName: row.displayName ?? undefined,
    email: row.email,
  }));
});

/**
 * Saves the user's account order. The list must name every connected account
 * exactly once, so a reorder racing a connect or disconnect is refused.
 */
export const reorderAccounts = Effect.fn("reorderAccounts")(
  function* reorderAccounts(emails: readonly string[]) {
    const matchesStoredAccounts = yield* withDatabaseClient((database) =>
      database.transaction(async (transaction) => {
        const stored = await transaction
          .select({ email: mailAccounts.email })
          .from(mailAccounts)
          .all();
        const storedEmails = new Set(stored.map(({ email }) => email));

        if (
          emails.length !== storedEmails.size ||
          !emails.every((email) => storedEmails.delete(email))
        ) {
          return false;
        }

        for (const [sortOrder, email] of emails.entries()) {
          // Account order updates must remain ordered within this transaction.
          // oxlint-disable-next-line eslint/no-await-in-loop
          await transaction
            .update(mailAccounts)
            .set({ sortOrder })
            .where(eq(mailAccounts.email, email))
            .run();
        }
        return true;
      })
    ).pipe(
      Effect.mapError(
        () => new AccountsError({ message: "Could not save account order" })
      )
    );

    if (!matchesStoredAccounts) {
      return yield* new AccountsError({
        message: "Account order did not match connected accounts",
      });
    }
  }
);
