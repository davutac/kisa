import { mailMessages, mailThreads } from "@repo/database/schemas";
import type { MessageId } from "@repo/mail/ids";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";

import type { GmailThreadRequest } from "../../../shared/ipc/mail";
import { isAutomaticCategorizationEnabled } from "../../settings/account-settings";
import { showNewMailNotifications } from "../new-mail-notifications";
import type { NewMailNotificationMessage } from "../new-mail-notifications";
import { publishNewMailThreads } from "../new-thread-events";
import { getSenderBrand, hasCachedSenderBrand } from "../sender-brand";
import { MailDatabase } from "./mail-database";

/** What a notification's buttons do. */
export interface ArrivalActions {
  readonly markRead: (request: GmailThreadRequest) => void;
  readonly trash: (request: GmailThreadRequest) => void;
}

/**
 * A logo only from the cache, checked against the message's own
 * authentication headers: a notification never contacts the sender.
 */
const resolveSenderBrand = Effect.fn("MailArrivals.resolveSenderBrand")(
  function* resolveSenderBrand(message: NewMailNotificationMessage) {
    if (!(yield* hasCachedSenderBrand(message.fromAddress))) {
      return null;
    }
    const database = yield* MailDatabase;
    const row = yield* database.use("Could not load a sender", (db) =>
      db.query.mailMessages.findFirst({
        columns: { headers: true },
        where: { accountId: message.accountId, messageId: message.messageId },
      })
    );
    return yield* getSenderBrand({
      allowDiscovery: false,
      from: message.fromAddress,
      headers: row?.headers ?? [],
    });
  }
);

/**
 * Inbox conversations that every arrived message belongs to and that had no
 * message before: the new conversations automatic categorization looks at.
 */
const newInboxThreads = Effect.fn("MailArrivals.newInboxThreads")(
  function* newInboxThreads(accountId: string, arrived: readonly MessageId[]) {
    const database = yield* MailDatabase;
    return yield* database.use("Could not load new mail", async (db) => {
      const messages = await db
        .select({ threadId: mailMessages.threadId })
        .from(mailMessages)
        .where(
          and(
            eq(mailMessages.accountId, accountId),
            inArray(mailMessages.messageId, [...arrived])
          )
        )
        .all();
      const arrivedPerThread = new Map<string, number>();
      for (const { threadId } of messages) {
        arrivedPerThread.set(
          threadId,
          (arrivedPerThread.get(threadId) ?? 0) + 1
        );
      }
      if (arrivedPerThread.size === 0) {
        return [];
      }
      const threads = await db
        .select({
          isInInbox: mailThreads.isInInbox,
          messageCount: mailThreads.messageCount,
          threadId: mailThreads.threadId,
        })
        .from(mailThreads)
        .where(
          and(
            eq(mailThreads.accountId, accountId),
            inArray(mailThreads.threadId, [...arrivedPerThread.keys()])
          )
        )
        .all();
      return threads
        .filter(
          (thread) =>
            thread.isInInbox &&
            thread.messageCount === arrivedPerThread.get(thread.threadId)
        )
        .map((thread) => thread.threadId);
    });
  }
);

/**
 * Tells the user about mail an incremental sync found: a notification for
 * unread Inbox mail, and new conversations for automatic categorization.
 */
export const announceArrivals = Effect.fn("MailArrivals.announce")(
  function* announceArrivals(
    accountId: string,
    arrived: readonly MessageId[],
    actions: ArrivalActions
  ) {
    if (arrived.length === 0) {
      return;
    }

    const context = yield* Effect.context<MailDatabase>();
    yield* showNewMailNotifications(
      accountId,
      arrived,
      (message) =>
        resolveSenderBrand(message).pipe(Effect.provideContext(context)),
      actions.markRead,
      actions.trash
    ).pipe(Effect.ignore);

    if (
      yield* isAutomaticCategorizationEnabled(accountId).pipe(
        Effect.orElseSucceed(() => false)
      )
    ) {
      const threadIds = yield* newInboxThreads(accountId, arrived);
      if (threadIds.length > 0) {
        yield* Effect.sync(() =>
          publishNewMailThreads({ accountId, threadIds })
        );
      }
    }
  }
);
