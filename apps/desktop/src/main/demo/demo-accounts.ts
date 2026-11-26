import { mailAccounts } from "@repo/database/schemas";
import { Effect, Redacted } from "effect";

import { sealPassword } from "../auth/sealed-credentials";
import { withDatabaseClient } from "../database-query";
import { DEMO_ACCOUNTS } from "./demo-mailbox";

/**
 * Not a secret: a demo account signs in to nothing. It is sealed like any
 * app password so the engine reads the account's sign-in the usual way, with
 * no branch for accounts that have none. The Outlook account has one too,
 * where a real one keeps a Microsoft refresh token: renewing a token would
 * ask Microsoft's servers.
 */
const PLACEHOLDER_PASSWORD = Redacted.make("demo");

/**
 * Connects the demo accounts in the demo profile's new database. Only their
 * rows are written: the engine then reads their mail from the in-memory
 * servers as it reads any account's, and builds the cache itself.
 */
export const connectDemoAccounts = Effect.fn("connectDemoAccounts")(
  function* connectDemoAccounts() {
    const credentials = yield* sealPassword(PLACEHOLDER_PASSWORD);
    const now = Date.now();

    yield* withDatabaseClient((database) =>
      database
        .insert(mailAccounts)
        .values(
          DEMO_ACCOUNTS.map((account, sortOrder) => ({
            accountId: account.accountId,
            createdAt: now,
            credentials,
            dialect: account.dialect,
            displayName: account.displayName,
            email: account.email,
            imapHost: account.host,
            imapPort: 993,
            imapSecurity: "tls" as const,
            provider: account.provider,
            smtpHost: account.host,
            smtpPort: 587,
            smtpSecurity: "starttls" as const,
            sortOrder,
            updatedAt: now,
            username: account.email,
          }))
        )
        .onConflictDoNothing()
        .run()
    );
  }
);
