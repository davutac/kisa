import { gunzipSync } from "node:zlib";

import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import { mailLabels, mailMessages, mailThreads } from "@repo/database/schemas";
import type { StoredMailAttachment } from "@repo/database/schemas";
import { SystemLabel, userLabelPath } from "@repo/mail/ids";
import { and, asc, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";

import type {
  GmailAttachmentSummary,
  GmailCachedThreadPage,
  GmailCachedThreadPageRequest,
  GmailLabelCatalog,
  GmailMailbox,
  GmailThreadMessage,
  GmailThreadSummary,
} from "../../../shared/ipc/mail";
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
): GmailAttachmentSummary =>
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

export const toThreadSummary = (row: ThreadRow): GmailThreadSummary => ({
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
  snippet: row.snippet,
  subject: row.subject,
  threadId: row.threadId,
});

const mailboxCondition = (mailbox: GmailMailbox) => {
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
  return and(
    or(eq(mailThreads.isInInbox, true), eq(mailThreads.isInSent, true)),
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
  request: GmailCachedThreadPageRequest
): Promise<GmailCachedThreadPage> => {
  if (request.accountIds.length === 0) {
    return { threads: [] };
  }

  const labelIds = [
    ...new Set(
      (request.labelNames ?? [])
        .map((name) => name.trim())
        .filter((name) => name.length > 0)
        .map((name) => `u:${name}`.toLowerCase())
    ),
  ];
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
            ),
        ...labelIds.map(
          (labelId) => sql`EXISTS (
            SELECT 1 FROM json_each(${mailThreads.labelIds}) AS thread_label
            WHERE lower(thread_label.value) = ${labelId}
          )`
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
): Promise<readonly GmailThreadSummary[]> => {
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
  readonly message: GmailThreadMessage;
}

export interface Conversation {
  readonly isUnread: boolean;
  readonly labels: readonly string[];
  readonly messages: readonly ConversationMessage[];
  readonly missingBodies: boolean;
  readonly subject: string;
}

const toBody = (row: MessageRow): GmailThreadMessage["body"] => {
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

  const rows = await database
    .select()
    .from(mailMessages)
    .where(
      and(
        eq(mailMessages.accountId, accountId),
        eq(mailMessages.threadId, threadId)
      )
    )
    .orderBy(asc(mailMessages.receivedAt), asc(mailMessages.messageId))
    .all();
  const messages = rows.map(toConversationMessage);

  return {
    isUnread: thread.isUnread,
    labels: thread.labelIds
      .filter((label) => label !== SystemLabel.unread)
      .map(toLabelName),
    messages,
    missingBodies: rows.some((row) => row.bodyState !== "ready"),
    subject: messages[0]?.message.subject ?? "(No subject)",
  };
};

export const readLabelCatalog = async (
  database: RemoteDatabaseClient,
  accountId: string
): Promise<GmailLabelCatalog> => {
  const rows = await database
    .select()
    .from(mailLabels)
    .where(eq(mailLabels.accountId, accountId))
    .orderBy(asc(mailLabels.kind), asc(mailLabels.name))
    .all();

  return {
    labels: rows.map((row) => ({
      color:
        row.backgroundColor === null || row.textColor === null
          ? undefined
          : { background: row.backgroundColor, text: row.textColor },
      id: row.labelId,
      name: row.kind === "user" ? toLabelName(row.labelId) : row.name,
      type: row.kind,
    })),
  };
};

export const readHasUnreadSpam = async (
  database: RemoteDatabaseClient,
  accountIds: readonly string[]
): Promise<boolean> => {
  if (accountIds.length === 0) {
    return false;
  }

  const [row] = await database
    .select({ threadId: mailThreads.threadId })
    .from(mailThreads)
    .where(
      and(
        inArray(mailThreads.accountId, [...new Set(accountIds)]),
        eq(mailThreads.isInSpam, true),
        eq(mailThreads.isUnread, true)
      )
    )
    .limit(1)
    .all();
  return row !== undefined;
};

/** Unread Inbox conversations across accounts, for the dock badge. */
export const readUnreadInboxCount = async (
  database: RemoteDatabaseClient
): Promise<number> => {
  const [row] = await database
    .select({ count: sql<number>`count(*)` })
    .from(mailThreads)
    .where(
      and(
        eq(mailThreads.isInInbox, true),
        eq(mailThreads.isUnread, true),
        eq(mailThreads.isInSpam, false),
        eq(mailThreads.isInTrash, false)
      )
    )
    .all();
  return row?.count ?? 0;
};
