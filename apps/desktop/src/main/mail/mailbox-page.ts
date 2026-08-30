import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import { gmailThreads } from "@repo/database/schemas";
import { and, asc, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";

import type {
  GmailCachedThreadPage,
  GmailCachedThreadPageRequest,
  GmailMailbox,
  GmailThreadSummary,
} from "../../shared/ipc/mail";

export const THREAD_PAGE_SIZE = 50;

export type CachedThreadRow = typeof gmailThreads.$inferSelect;

const getMailboxCondition = (mailbox: GmailMailbox) => {
  if (mailbox === "spam") {
    return eq(gmailThreads.isInSpam, true);
  }
  if (mailbox === "trash") {
    return eq(gmailThreads.isInTrash, true);
  }
  if (mailbox === "sent") {
    return and(
      eq(gmailThreads.isInSent, true),
      eq(gmailThreads.isInSpam, false),
      eq(gmailThreads.isInTrash, false)
    );
  }
  return and(
    or(eq(gmailThreads.isInInbox, true), eq(gmailThreads.isInSent, true)),
    eq(gmailThreads.isInSpam, false),
    eq(gmailThreads.isInTrash, false)
  );
};

export const toCachedThreadSummary = (
  row: CachedThreadRow
): GmailThreadSummary => {
  const attachments = row.attachments ?? [];

  return {
    accountId: row.accountEmail,
    attachments,
    from: row.from,
    hasAttachments: row.hasAttachments ?? attachments.length > 0,
    isUnread: row.isUnread,
    labels: row.labels ?? [],
    latestAt: row.latestAt,
    messageCount: row.messageCount,
    snippet: row.snippet,
    subject: row.subject,
    threadId: row.threadId,
  };
};

export const listCachedThreadPageFromDatabase = async (
  database: RemoteDatabaseClient,
  request: GmailCachedThreadPageRequest
): Promise<GmailCachedThreadPage> => {
  if (request.accountIds.length === 0) {
    return { threads: [] };
  }

  const mailbox = request.mailbox ?? "inbox";
  const labelNames = [
    ...new Set(
      (request.labelNames ?? [])
        .map((labelName) => labelName.trim().toLowerCase())
        .filter((labelName) => labelName.length > 0)
    ),
  ];
  const rows = await database
    .select()
    .from(gmailThreads)
    .where(
      and(
        inArray(gmailThreads.accountEmail, [...request.accountIds]),
        // These predicates stay in SQL so sparse labels cannot produce short
        // pages while the cursor walks unrelated cached threads.
        getMailboxCondition(mailbox),
        request.unreadOnly === true
          ? eq(gmailThreads.isUnread, true)
          : undefined,
        request.cursor === undefined
          ? undefined
          : or(
              lt(gmailThreads.latestAt, request.cursor.latestAt),
              and(
                eq(gmailThreads.latestAt, request.cursor.latestAt),
                gt(gmailThreads.accountEmail, request.cursor.accountId)
              ),
              and(
                eq(gmailThreads.latestAt, request.cursor.latestAt),
                eq(gmailThreads.accountEmail, request.cursor.accountId),
                gt(gmailThreads.threadId, request.cursor.threadId)
              )
            ),
        ...labelNames.map(
          (labelName) => sql`EXISTS (
            SELECT 1
            FROM json_each(coalesce(${gmailThreads.labels}, '[]')) AS thread_label
            WHERE lower(thread_label.value) = lower(${labelName})
          )`
        )
      )
    )
    .orderBy(
      desc(gmailThreads.latestAt),
      asc(gmailThreads.accountEmail),
      asc(gmailThreads.threadId)
    )
    .limit(THREAD_PAGE_SIZE + 1);
  const pageRows = rows.slice(0, THREAD_PAGE_SIZE);
  const threads = pageRows.map(toCachedThreadSummary);
  const lastRow = pageRows.at(-1);

  return rows.length > THREAD_PAGE_SIZE && lastRow !== undefined
    ? {
        nextCursor: {
          accountId: lastRow.accountEmail,
          latestAt: lastRow.latestAt,
          threadId: lastRow.threadId,
        },
        threads,
      }
    : { threads };
};
