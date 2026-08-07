import type {
  GmailCachedThreadPageRequest,
  GmailThreadCursor,
  GmailThreadPageReply,
  GmailThreadPageRequest,
  GmailThreadSummary,
} from "@/shared/ipc/mail";

import { hasInboxLabel, withoutInboxLabel, withReadStateLabel } from "./label";
import { getThreadSelectionKey } from "./thread-selection";

export type ThreadPatch = (thread: GmailThreadSummary) => GmailThreadSummary;

const compareAscending = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
};

export const mergeAndSortThreads = (
  ...groups: readonly (readonly GmailThreadSummary[])[]
): readonly GmailThreadSummary[] => {
  const threadsById = new Map<string, GmailThreadSummary>();

  for (const group of groups) {
    for (const thread of group) {
      threadsById.set(`${thread.accountId}:${thread.threadId}`, thread);
    }
  }

  return [...threadsById.values()].toSorted((left, right) => {
    const latestAtOrder = right.latestAt - left.latestAt;

    if (latestAtOrder !== 0) {
      return latestAtOrder;
    }

    const accountOrder = compareAscending(left.accountId, right.accountId);

    return accountOrder === 0
      ? compareAscending(left.threadId, right.threadId)
      : accountOrder;
  });
};

export const filterThreadsByScope = (
  threads: readonly GmailThreadSummary[],
  accountIds: readonly string[],
  unreadOnly: boolean
): readonly GmailThreadSummary[] =>
  threads.filter(
    ({ accountId, isUnread, labels }) =>
      accountIds.includes(accountId) &&
      hasInboxLabel(labels) &&
      (!unreadOnly || isUnread)
  );

export const patchThreads = (
  threads: readonly GmailThreadSummary[],
  threadKey: string,
  patch: ThreadPatch
): readonly GmailThreadSummary[] =>
  threads.map((thread) =>
    getThreadSelectionKey(thread) === threadKey ? patch(thread) : thread
  );

export const toReadStateThread = (
  thread: GmailThreadSummary,
  isUnread: boolean
): GmailThreadSummary => ({
  ...thread,
  isUnread,
  labels: withReadStateLabel(thread.labels, isUnread),
});

// Trashing drops the thread out of every mailbox scope, because each one is
// filtered down to inbox threads.
export const toTrashedThread = (
  thread: GmailThreadSummary
): GmailThreadSummary => ({
  ...thread,
  labels: withoutInboxLabel(thread.labels),
});

export const toThreadCursor = (
  thread: GmailThreadSummary
): GmailThreadCursor => ({
  accountId: thread.accountId,
  latestAt: thread.latestAt,
  threadId: thread.threadId,
});

export const createCachedThreadPageRequest = (
  accountIds: readonly string[],
  unreadOnly: boolean,
  cursor?: GmailThreadCursor
): GmailCachedThreadPageRequest => ({
  accountIds,
  ...(cursor === undefined ? {} : { cursor }),
  ...(unreadOnly ? { unreadOnly: true } : {}),
});

export const createGmailThreadPageRequest = (
  accountId: string,
  query: string,
  pageToken?: string
): GmailThreadPageRequest => ({
  accountId,
  ...(pageToken === undefined ? {} : { pageToken }),
  ...(query.length > 0 ? { query } : {}),
});

export const getGmailQuery = (query: string, unreadOnly: boolean): string =>
  [query.trim(), unreadOnly ? "is:unread" : ""]
    .filter((value) => value.length > 0)
    .join(" ");

export const getMailboxScopeKey = (
  accountIds: readonly string[],
  unreadOnly: boolean
): string =>
  `${unreadOnly ? "unread" : "all"}\u0001${accountIds.join("\u0000")}`;

interface AdvancedThreadPages {
  nextPageTokens: ReadonlyMap<string, string>;
  threads: readonly GmailThreadSummary[];
}

export const advanceThreadPages = (
  currentPageTokens: ReadonlyMap<string, string>,
  pageTokenEntries: readonly (readonly [string, string])[],
  replies: readonly GmailThreadPageReply[]
): AdvancedThreadPages => {
  const nextPageTokens = new Map(currentPageTokens);
  const threads = replies.flatMap((reply, index) => {
    const accountId = pageTokenEntries[index]?.[0];

    // A failed page drops its token rather than keeping it for another try.
    // Retaining it is an infinite loop: the thread list does not grow, so
    // `hasNextPage` stays true, and the list's end-reached effect re-fires on
    // every render and reissues the same failing request — silently, because
    // the reply's error is not surfaced anywhere.
    if (!reply.ok) {
      if (accountId !== undefined) {
        nextPageTokens.delete(accountId);
      }

      return [];
    }

    if (accountId !== undefined) {
      if (reply.data.nextPageToken === undefined) {
        nextPageTokens.delete(accountId);
      } else {
        nextPageTokens.set(accountId, reply.data.nextPageToken);
      }
    }

    return reply.data.threads;
  });

  return { nextPageTokens, threads };
};
