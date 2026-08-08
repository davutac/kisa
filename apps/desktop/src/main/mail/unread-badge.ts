import { gmailThreads } from "@repo/database/schemas";
import { and, count, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";

import { setNativeUnreadBadgeCount } from "../app/native-unread-badge";
import { getDatabaseClient } from "../database";

// oxlint-disable-next-line unicorn/throw-new-error
class UnreadBadgeError extends Schema.TaggedErrorClass<UnreadBadgeError>()(
  "UnreadBadgeError",
  {
    cause: Schema.optional(Schema.Defect()),
    message: Schema.String,
  }
) {}

export const refreshUnreadBadge = Effect.fn("refreshUnreadBadge")(
  function* refreshUnreadBadge() {
    const database = yield* getDatabaseClient();
    const unreadCount = yield* Effect.try({
      catch: (cause) =>
        new UnreadBadgeError({
          cause,
          message: "Could not read the unread email count",
        }),
      try: () =>
        database
          .select({ value: count() })
          .from(gmailThreads)
          .where(
            and(
              eq(gmailThreads.isInInbox, true),
              eq(gmailThreads.isUnread, true)
            )
          )
          .all()
          .at(0)?.value ?? 0,
    });

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
