import { gunzipSync } from "node:zlib";

import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import { mailLabels, mailMessages, mailThreads } from "@repo/database/schemas";
import type { StoredMailAttachment } from "@repo/database/schemas";
import {
  SystemLabel,
  USER_LABEL_PREFIX,
  userLabelId,
  userLabelPath,
} from "@repo/mail/ids";
import { listedMessages } from "@repo/mail/listing";
import { and, asc, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";

import type {
  MailAttachmentSummary,
  MailCachedThreadPage,
  MailCachedThreadPageRequest,
  MailLabelCatalog,
  MailboxPlace,
  ThreadMessage,
  MailThreadSummary,
  MailUnreadCounts,
  MailUnreadLabels,
} from "../../../shared/ipc/mail";
import { isMailboxLabelPlace } from "../../../shared/ipc/mail";
import { labelTextColor } from "../../../shared/label-color";
import { listingPlaces } from "../../../shared/mailbox-places";
import { toDisplayedAttachment } from "../attachment-filename";

export const THREAD_PAGE_SIZE = 50;

/** What the interface calls a label: user labels by path, system by id. */
export const toLabelName = (labelId: string): string =>
  userLabelPath(labelId) ?? labelId;

const NEEDS_QUOTES = /[",:;<>@]/u;

/** `Name <address>`, quoting a name the address grammar would misread. */
export const formatMailbox = (
  name: string | null | undefined,
  address: string
): string => {
  if (address.length === 0) {
    return name ?? "Unknown sender";
  }
  if (name === null || name === undefined || name.length === 0) {
    return address;
  }
  const quoted = NEEDS_QUOTES.test(name)
    ? `"${name.replaceAll(/["\\]/gu, "")}"`
    : name;
  return `${quoted} <${address}>`;
};

const fallbackFilename = (attachment: StoredMailAttachment): string => {
  const [, subtype = "bin"] = attachment.mediaType.split("/");
  const extension = subtype.replaceAll(/[^\da-z]/giu, "").slice(0, 8);
  return `attachment.${extension.length === 0 ? "bin" : extension}`;
};

export const toAttachmentSummary = (
  attachment: StoredMailAttachment,
  messageId: string
): MailAttachmentSummary =>
  toDisplayedAttachment({
    attachmentId: attachment.section,
    filename:
      attachment.filename.length > 0
        ? attachment.filename
        : fallbackFilename(attachment),
    mediaType: attachment.mediaType,
    messageId,
    partId: attachment.section,
    size: attachment.size,
  });

type ThreadRow = typeof mailThreads.$inferSelect;

/** The places that list a conversation's row: see `listingPlaces`. */
export const threadPlaces = (
  row: Pick<
    ThreadRow,
    "isInInbox" | "isInSent" | "isInSpam" | "isInTrash" | "labelIds"
  >
): readonly string[] =>
  listingPlaces({
    isInInbox: row.isInInbox,
    isInSent: row.isInSent,
    isInSpam: row.isInSpam,
    isInTrash: row.isInTrash,
    isStarred: row.labelIds.includes(SystemLabel.starred),
    userLabels: row.labelIds.flatMap((labelId) => userLabelPath(labelId) ?? []),
  });

export const toThreadSummary = (row: ThreadRow): MailThreadSummary => ({
  accountId: row.accountId,
  attachments: row.attachments.map((attachment) =>
    toAttachmentSummary(attachment, attachment.messageId)
  ),
  from: formatMailbox(row.fromName, row.fromAddress),
  hasAttachments: row.hasAttachments,
  isUnread: row.isUnread,
  labels: row.labelIds.map(toLabelName),
  latestAt: row.latestAt,
  messageCount: row.messageCount,
  places: threadPlaces(row),
  snippet: row.snippet,
  subject: row.subject,
  threadId: row.threadId,
});

/**
 * The threads a mailbox place lists: `listingPlaces`, stated in SQL so a
 * page is an index scan. A label lists every conversation
 * carrying it outside Spam and Trash, as Gmail's label view does, so mail
 * archived under a label is still there. SQLite folds both sides of the id,
 * so the match ignores ASCII case, as the label catalog does, and a label
 * with other capitals still matches itself. Starred is listed the same way,
 * by its system id. The Inbox lists only the Inbox, so archiving a
 * conversation always takes it off the list.
 */
const mailboxCondition = (mailbox: MailboxPlace) => {
  if (isMailboxLabelPlace(mailbox)) {
    return and(
      eq(mailThreads.isInSpam, false),
      eq(mailThreads.isInTrash, false),
      sql`EXISTS (
        SELECT 1 FROM json_each(${mailThreads.labelIds}) AS thread_label
        WHERE lower(thread_label.value) = lower(${userLabelId(mailbox.label)})
      )`
    );
  }
  if (mailbox === "spam") {
    return eq(mailThreads.isInSpam, true);
  }
  if (mailbox === "trash") {
    return eq(mailThreads.isInTrash, true);
  }
  if (mailbox === "sent") {
    return and(
      eq(mailThreads.isInSent, true),
      eq(mailThreads.isInSpam, false),
      eq(mailThreads.isInTrash, false)
    );
  }
  if (mailbox === "starred") {
    return and(
      eq(mailThreads.isInSpam, false),
      eq(mailThreads.isInTrash, false),
      sql`EXISTS (
        SELECT 1 FROM json_each(${mailThreads.labelIds}) AS thread_label
        WHERE thread_label.value = ${SystemLabel.starred}
      )`
    );
  }
  return and(
    eq(mailThreads.isInInbox, true),
    eq(mailThreads.isInSpam, false),
    eq(mailThreads.isInTrash, false)
  );
};

/**
 * One keyset page of a mailbox, newest first. Every predicate stays in SQL so
 * a sparse label cannot produce short pages while the cursor walks past
 * threads the page will not show.
 */
export const readThreadPage = async (
  database: RemoteDatabaseClient,
  request: MailCachedThreadPageRequest
): Promise<MailCachedThreadPage> => {
  if (request.accountIds.length === 0) {
    return { threads: [] };
  }

  const { cursor } = request;
  const rows = await database
    .select()
    .from(mailThreads)
    .where(
      and(
        inArray(mailThreads.accountId, [...request.accountIds]),
        mailboxCondition(request.mailbox ?? "inbox"),
        request.unreadOnly === true
          ? eq(mailThreads.isUnread, true)
          : undefined,
        cursor === undefined
          ? undefined
          : or(
              lt(mailThreads.latestAt, cursor.latestAt),
              and(
                eq(mailThreads.latestAt, cursor.latestAt),
                gt(mailThreads.accountId, cursor.accountId)
              ),
              and(
                eq(mailThreads.latestAt, cursor.latestAt),
                eq(mailThreads.accountId, cursor.accountId),
                gt(mailThreads.threadId, cursor.threadId)
              )
            )
      )
    )
    .orderBy(
      desc(mailThreads.latestAt),
      asc(mailThreads.accountId),
      asc(mailThreads.threadId)
    )
    .limit(THREAD_PAGE_SIZE + 1);
  const pageRows = rows.slice(0, THREAD_PAGE_SIZE);
  const lastRow = pageRows.at(-1);

  return {
    nextCursor:
      rows.length > THREAD_PAGE_SIZE && lastRow !== undefined
        ? {
            accountId: lastRow.accountId,
            latestAt: lastRow.latestAt,
            threadId: lastRow.threadId,
          }
        : undefined,
    threads: pageRows.map(toThreadSummary),
  };
};

export const readThreadSummaries = async (
  database: RemoteDatabaseClient,
  accountId: string,
  threadIds: readonly string[]
): Promise<readonly MailThreadSummary[]> => {
  if (threadIds.length === 0) {
    return [];
  }

  const rows = await database
    .select()
    .from(mailThreads)
    .where(
      and(
        eq(mailThreads.accountId, accountId),
        inArray(mailThreads.threadId, [...threadIds])
      )
    )
    .all();
  return rows.map(toThreadSummary);
};

const formatAddresses = (addresses: readonly string[]): string | undefined =>
  addresses.length === 0 ? undefined : addresses.join(", ");

type MessageRow = typeof mailMessages.$inferSelect;

/** What a cached message needs besides its DTO: inline images and branding. */
export interface ConversationMessage {
  readonly attachments: readonly StoredMailAttachment[];
  readonly fromAddress: string;
  readonly headers: readonly {
    readonly name: string;
    readonly value: string;
  }[];
  readonly message: ThreadMessage;
}

export interface Conversation {
  readonly isUnread: boolean;
  readonly labels: readonly string[];
  readonly messages: readonly ConversationMessage[];
  readonly missingBodies: boolean;
  readonly places: readonly string[];
  readonly subject: string;
}

const toBody = (row: MessageRow): ThreadMessage["body"] => {
  if (row.bodyHtml !== null) {
    try {
      return { html: gunzipSync(row.bodyHtml).toString("utf-8") };
    } catch {
      return { text: row.bodyText ?? "" };
    }
  }
  return { text: row.bodyText ?? "" };
};

const toConversationMessage = (row: MessageRow): ConversationMessage => {
  const attachments = row.attachments ?? [];

  return {
    attachments,
    fromAddress: row.fromAddress,
    headers: row.headers ?? [],
    message: {
      attachments: attachments
        .filter(
          (attachment) =>
            attachment.filename.length > 0 ||
            attachment.disposition === "attachment" ||
            attachment.contentId !== undefined
        )
        .map((attachment) => toAttachmentSummary(attachment, row.messageId)),
      bcc: formatAddresses(row.bccAddresses),
      body: toBody(row),
      cc: formatAddresses(row.ccAddresses),
      from: formatMailbox(row.fromName, row.fromAddress),
      id: row.messageId,
      labelIds: row.labelIds.filter((label) => label !== SystemLabel.unread),
      replyTo: row.replyToAddress ?? undefined,
      senderAuthenticated: row.senderAuthenticated,
      sentAt: row.receivedAt,
      snippet: row.snippet,
      subject: row.subject.length === 0 ? "(No subject)" : row.subject,
      to: formatAddresses(row.toAddresses),
    },
  };
};

/** A cached conversation, oldest message first, or `undefined` if unknown. */
export const readConversation = async (
  database: RemoteDatabaseClient,
  accountId: string,
  threadId: string
): Promise<Conversation | undefined> => {
  const [thread] = await database
    .select()
    .from(mailThreads)
    .where(
      and(
        eq(mailThreads.accountId, accountId),
        eq(mailThreads.threadId, threadId)
      )
    )
    .limit(1)
    .all();

  if (thread === undefined) {
    return;
  }

  // The messages the list's row was built from, so opening a conversation
  // shows what its row promised.
  const rows = listedMessages(
    await database
      .select()
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.accountId, accountId),
          eq(mailMessages.threadId, threadId)
        )
      )
      .orderBy(asc(mailMessages.receivedAt), asc(mailMessages.messageId))
      .all()
  );
  const messages = rows.map(toConversationMessage);

  return {
    isUnread: thread.isUnread,
    labels: thread.labelIds
      .filter((label) => label !== SystemLabel.unread)
      .map(toLabelName),
    messages,
    missingBodies: rows.some((row) => row.bodyState !== "ready"),
    places: threadPlaces(thread),
    subject: messages[0]?.message.subject ?? "(No subject)",
  };
};

export const readLabelCatalog = async (
  database: RemoteDatabaseClient,
  accountId: string
): Promise<MailLabelCatalog> => {
  const rows = await database
    .select()
    .from(mailLabels)
    .where(eq(mailLabels.accountId, accountId))
    .orderBy(asc(mailLabels.kind), asc(mailLabels.name))
    .all();

  return {
    labels: rows.map((row) => ({
      color:
        row.backgroundColor === null
          ? undefined
          : {
              background: row.backgroundColor,
              text: labelTextColor(row.backgroundColor),
            },
      id: row.labelId,
      name: row.kind === "user" ? toLabelName(row.labelId) : row.name,
      type: row.kind,
    })),
  };
};

const toAccountList = (accountIds: readonly string[]) =>
  sql.join(
    [...new Set(accountIds)].map((accountId) => sql`${accountId}`),
    sql`, `
  );

/**
 * Unread conversations in the accounts' Inbox, as the Unread filter lists
 * it, and in their Spam. The Inbox count reads `mail_threads_unread_idx`,
 * which holds only unread conversations outside Spam and Trash; Spam is
 * bounded by the server's own retention.
 */
export const readUnreadCounts = async (
  database: RemoteDatabaseClient,
  accountIds: readonly string[]
): Promise<MailUnreadCounts> => {
  if (accountIds.length === 0) {
    return { inbox: 0, spam: 0 };
  }

  const accounts = toAccountList(accountIds);
  const [row] = await database.values<[number, number]>(sql`
    SELECT
      (SELECT count(*) FROM ${mailThreads} INDEXED BY mail_threads_unread_idx
        WHERE ${mailThreads.accountId} IN (${accounts})
          AND ${mailThreads.isInInbox} = 1
          AND ${mailThreads.isUnread} = 1
          AND ${mailThreads.isInSpam} = 0
          AND ${mailThreads.isInTrash} = 0),
      (SELECT count(*) FROM ${mailThreads}
        WHERE ${mailThreads.accountId} IN (${accounts})
          AND ${mailThreads.isInSpam} = 1
          AND ${mailThreads.isUnread} = 1)
  `);
  return { inbox: row?.[0] ?? 0, spam: row?.[1] ?? 0 };
};

/**
 * Unread conversations on each user label's place, the condition
 * `mailboxCondition` lists a label by: outside Spam and Trash, whether or not
 * in the Inbox. Paths keep the case the thread carries; the renderer folds
 * them as the catalog does. Each account's total counts a conversation once
 * however many of its labels it carries, for the row that stands for them all.
 */
export const readUnreadLabels = async (
  database: RemoteDatabaseClient,
  accountIds: readonly string[]
): Promise<MailUnreadLabels> => {
  if (accountIds.length === 0) {
    return { accounts: [], labels: [] };
  }

  const accounts = toAccountList(accountIds);
  const labelRows = await database.values<[string, string, number]>(sql`
    SELECT t.account_id, thread_label.value, count(DISTINCT t.thread_id)
    FROM mail_threads t
    JOIN json_each(t.label_ids) AS thread_label
    WHERE t.account_id IN (${accounts})
      AND t.is_unread = 1
      AND t.is_in_spam = 0
      AND t.is_in_trash = 0
      AND thread_label.type = 'text'
    GROUP BY t.account_id, thread_label.value
  `);
  const accountRows = await database.values<[string, number]>(sql`
    SELECT t.account_id, count(*)
    FROM mail_threads t
    WHERE t.account_id IN (${accounts})
      AND t.is_unread = 1
      AND t.is_in_spam = 0
      AND t.is_in_trash = 0
      AND EXISTS (
        SELECT 1 FROM json_each(t.label_ids) AS thread_label
        WHERE thread_label.type = 'text'
          AND substr(thread_label.value, 1, ${USER_LABEL_PREFIX.length}) = ${USER_LABEL_PREFIX}
          AND length(thread_label.value) > ${USER_LABEL_PREFIX.length}
      )
    GROUP BY t.account_id
  `);

  return {
    accounts: accountRows.map(([accountId, count]) => ({ accountId, count })),
    labels: labelRows.flatMap(([accountId, labelId, count]) => {
      const label = userLabelPath(labelId);
      return label === undefined || label.length === 0
        ? []
        : [{ accountId, count, label }];
    }),
  };
};

/**
 * Unread Inbox conversations across accounts, for the dock badge. It counts
 * `mail_threads_unread_idx`, which holds only unread conversations outside
 * Spam and Trash: left to choose, SQLite walks every thread outside Trash.
 */
export const readUnreadInboxCount = async (
  database: RemoteDatabaseClient
): Promise<number> => {
  const [row] = await database.values<[number]>(sql`
    SELECT count(*) FROM ${mailThreads} INDEXED BY mail_threads_unread_idx
    WHERE ${mailThreads.isInInbox} = 1
      AND ${mailThreads.isUnread} = 1
      AND ${mailThreads.isInSpam} = 0
      AND ${mailThreads.isInTrash} = 0
  `);
  return row?.[0] ?? 0;
};
