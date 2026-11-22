import { mailAccounts, mailThreads } from "@repo/database/schemas";
import { and, count, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";

import { setNativeUnreadBadgeCount } from "../app/native-unread-badge";
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
    // Joined to the accounts table so a disconnected account's leftovers
    // never count.
    const [unread] = yield* withDatabaseClient((database) =>
      database
        .select({ value: count() })
        .from(mailThreads)
        .innerJoin(
          mailAccounts,
          eq(mailAccounts.accountId, mailThreads.accountId)
        )
        .where(
          and(
            eq(mailThreads.isInInbox, true),
            eq(mailThreads.isUnread, true),
            eq(mailThreads.isInSpam, false),
            eq(mailThreads.isInTrash, false)
          )
        )
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

    const unreadCount = unread?.value ?? 0;

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
