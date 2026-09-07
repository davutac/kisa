import { gmailThreads, googleAccounts } from "@repo/database/schemas";
import { and, count, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";

import { setNativeUnreadBadgeCount } from "../app/native-unread-badge";
import { isUserOwnedOAuthClient } from "../auth/google-account-credentials";
import { withDatabaseClient } from "../database-query";

// oxlint-disable-next-line unicorn/throw-new-error
class UnreadBadgeError extends Schema.TaggedError<UnreadBadgeError>()(
  "UnreadBadgeError",
  {
    cause: Schema.optional(Schema.Defect()),
    message: Schema.String,
  }
) {}

export const refreshUnreadBadge = Effect.fn("refreshUnreadBadge")(
  function* refreshUnreadBadge() {
    const accountCounts = yield* withDatabaseClient((database) =>
      database
        .select({ credentials: googleAccounts.credentials, value: count() })
        .from(gmailThreads)
        .innerJoin(
          googleAccounts,
          eq(googleAccounts.email, gmailThreads.accountEmail)
        )
        .where(
          and(eq(gmailThreads.isInInbox, true), eq(gmailThreads.isUnread, true))
        )
        .groupBy(googleAccounts.email)
        .all()
    ).pipe(
      Effect.mapError(
        (cause) =>
          new UnreadBadgeError({
            cause,
            message: "Could not read the unread email count",
          })
      )
    );

    // SQLite counts at mailbox scale; main only checks one grant per account.
    const unreadCount = accountCounts.reduce(
      (total, { credentials, value }) =>
        total + (isUserOwnedOAuthClient(credentials) ? value : 0),
      0
    );

    yield* Effect.try({
      catch: (cause) =>
        new UnreadBadgeError({
          cause,
          message: "Could not update the unread email badge",
        }),
      try: () => setNativeUnreadBadgeCount(unreadCount),
    });
  }
);
