import type {
  MailCachedThreadPageRequest,
  MailboxPlace,
  MailThreadListChange,
  MailThreadCursor,
  MailThreadSummary,
} from "@/shared/ipc/mail";
import { mailboxPlaceKey } from "@/shared/mailbox-places";

import { getMailboxPlaceKey } from "./mailbox-place";

export const getThreadListChangeAccountId = (
  change: MailThreadListChange
): string =>
  change.kind === "upsert" ? change.thread.accountId : change.accountId;

const compareAscending = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
};

/** The list's order: newest first, the same as the cache's page query. */
const compareThreads = (
  left: MailThreadSummary,
  right: MailThreadSummary
): number => {
  const latestAtOrder = right.latestAt - left.latestAt;

  if (latestAtOrder !== 0) {
    return latestAtOrder;
  }

  const accountOrder = compareAscending(left.accountId, right.accountId);

  return accountOrder === 0
    ? compareAscending(left.threadId, right.threadId)
    : accountOrder;
};

export const mergeAndSortThreads = (
  ...groups: readonly (readonly MailThreadSummary[])[]
): readonly MailThreadSummary[] => {
  const threadsById = new Map<string, MailThreadSummary>();

  for (const group of groups) {
    for (const thread of group) {
      threadsById.set(`${thread.accountId}:${thread.threadId}`, thread);
    }
  }

  return [...threadsById.values()].toSorted(compareThreads);
};

/**
 * The rows a mailbox list shows. Whether a place lists a conversation is
 * main's answer, sent with it as `places`: the list only asks whether its
 * own place is among them, so a live update files a row exactly where the
 * cache's page query would.
 */
export const filterThreadsByScope = (
  threads: readonly MailThreadSummary[],
  accountIds: readonly string[],
  unreadOnly: boolean,
  mailbox: MailboxPlace = "inbox"
): readonly MailThreadSummary[] => {
  const place = mailboxPlaceKey(mailbox);

  return threads.filter(
    ({ accountId, isUnread, places }) =>
      accountIds.includes(accountId) &&
      places.includes(place) &&
      (!unreadOnly || isUnread)
  );
};

export const applyThreadListChanges = (
  threads: readonly MailThreadSummary[],
  changes: readonly MailThreadListChange[]
): readonly MailThreadSummary[] => {
  let updatedThreads = threads;

  for (const change of changes) {
    if (change.kind === "upsert") {
      updatedThreads = mergeAndSortThreads(updatedThreads, [change.thread]);
      continue;
    }

    updatedThreads = updatedThreads.filter(
      (thread) =>
        thread.accountId !== change.accountId ||
        thread.threadId !== change.threadId
    );
  }

  return updatedThreads;
};

/**
 * Live changes to the rows of a list whose membership a query decides, such
 * as search results: listed rows are updated or dropped, never added, until
 * the query runs again.
 */
export const updateListedThreads = (
  threads: readonly MailThreadSummary[],
  changes: readonly MailThreadListChange[]
): readonly MailThreadSummary[] => {
  const latest = new Map<string, MailThreadSummary | null>();

  for (const change of changes) {
    if (change.kind === "upsert") {
      latest.set(
        `${change.thread.accountId}:${change.thread.threadId}`,
        change.thread
      );
    } else {
      latest.set(`${change.accountId}:${change.threadId}`, null);
    }
  }

  if (latest.size === 0) {
    return threads;
  }

  return threads.flatMap((thread) => {
    const next = latest.get(`${thread.accountId}:${thread.threadId}`);

    if (next === undefined) {
      return [thread];
    }

    return next === null ? [] : [next];
  });
};

export const toThreadCursor = (
  thread: MailThreadSummary
): MailThreadCursor => ({
  accountId: thread.accountId,
  latestAt: thread.latestAt,
  threadId: thread.threadId,
});

export const createCachedThreadPageRequest = (
  accountIds: readonly string[],
  unreadOnly: boolean,
  mailbox: MailboxPlace = "inbox",
  cursor?: MailThreadCursor
): MailCachedThreadPageRequest => ({
  accountIds,
  cursor,
  mailbox,
  unreadOnly: unreadOnly || undefined,
});

export const getMailboxScopeKey = (
  accountIds: readonly string[],
  unreadOnly: boolean,
  mailbox: MailboxPlace = "inbox"
): string =>
  `${getMailboxPlaceKey(mailbox)}\u0001${unreadOnly ? "unread" : "all"}\u0001${accountIds.join("\u0000")}`;

/**
 * A freshly read first page, laid over the rows already listed. Within the
 * page's range the page is the truth, so a row it lacks has left the mailbox
 * even if no event said so. Rows beyond its last one, from later pages, are
 * kept until a page covers them; when the page is the whole mailbox there is
 * nothing beyond it.
 */
export const replaceFirstPage = (
  current: readonly MailThreadSummary[],
  page: readonly MailThreadSummary[],
  hasMore: boolean
): readonly MailThreadSummary[] => {
  const last = page.at(-1);

  const beyond =
    hasMore && last !== undefined
      ? current.filter((thread) => compareThreads(thread, last) > 0)
      : [];

  return mergeAndSortThreads(beyond, page);
};
