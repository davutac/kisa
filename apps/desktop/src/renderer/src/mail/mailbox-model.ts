import type {
  GmailCachedThreadPageRequest,
  GmailMailbox,
  GmailThreadListChange,
  GmailThreadCursor,
  GmailThreadSummary,
} from "@/shared/ipc/mail";

import { hasInboxLabel, hasSpamLabel } from "./label";
import {
  normalizeMailboxLabelSelection,
  threadMatchesMailboxLabels,
} from "./mailbox-labels";

export const getThreadListChangeAccountId = (
  change: GmailThreadListChange
): string =>
  change.kind === "upsert" ? change.thread.accountId : change.accountId;

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
  unreadOnly: boolean,
  mailbox: GmailMailbox = "inbox",
  labelNames: readonly string[] = []
): readonly GmailThreadSummary[] =>
  threads.filter(
    ({ accountId, isUnread, labels }) =>
      accountIds.includes(accountId) &&
      (mailbox === "spam" ? hasSpamLabel(labels) : hasInboxLabel(labels)) &&
      (!unreadOnly || isUnread) &&
      threadMatchesMailboxLabels(labels, labelNames)
  );

export const applyThreadListChanges = (
  threads: readonly GmailThreadSummary[],
  changes: readonly GmailThreadListChange[]
): readonly GmailThreadSummary[] => {
  let updatedThreads = threads;

  for (const change of changes) {
    if (change.kind === "upsert") {
      updatedThreads = mergeAndSortThreads(updatedThreads, [change.thread]);
      continue;
    }

    if (change.kind === "reload") {
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
  mailbox: GmailMailbox = "inbox",
  labelNames: readonly string[] = [],
  cursor?: GmailThreadCursor
): GmailCachedThreadPageRequest => {
  const normalizedLabelNames = normalizeMailboxLabelSelection(labelNames);

  return {
    accountIds,
    cursor,
    labelNames:
      normalizedLabelNames.length === 0 ? undefined : normalizedLabelNames,
    mailbox,
    unreadOnly: unreadOnly || undefined,
  };
};

export const getMailboxScopeKey = (
  accountIds: readonly string[],
  unreadOnly: boolean,
  mailbox: GmailMailbox = "inbox",
  labelNames: readonly string[] = []
): string => {
  const normalizedLabelNames = normalizeMailboxLabelSelection(labelNames);

  return `${mailbox}\u0001${unreadOnly ? "unread" : "all"}\u0001${accountIds.join("\u0000")}\u0001${normalizedLabelNames.join("\u0000")}`;
};
