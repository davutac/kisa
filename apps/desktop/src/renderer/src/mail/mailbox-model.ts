import type {
  MailCachedThreadPageRequest,
  Mailbox,
  MailThreadListChange,
  MailThreadCursor,
  MailThreadSummary,
} from "@/shared/ipc/mail";

import {
  hasInboxLabel,
  hasSentLabel,
  hasSpamLabel,
  hasTrashLabel,
} from "./label";
import {
  normalizeMailboxLabelSelection,
  threadMatchesMailboxLabels,
} from "./mailbox-labels";

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

export const mergeAndSortThreads = (
  ...groups: readonly (readonly MailThreadSummary[])[]
): readonly MailThreadSummary[] => {
  const threadsById = new Map<string, MailThreadSummary>();

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

const threadMatchesMailbox = (
  labels: readonly string[],
  mailbox: Mailbox
): boolean => {
  if (mailbox === "spam") {
    return hasSpamLabel(labels);
  }
  if (mailbox === "trash") {
    return hasTrashLabel(labels);
  }
  if (mailbox === "sent") {
    return (
      hasSentLabel(labels) && !hasSpamLabel(labels) && !hasTrashLabel(labels)
    );
  }
  return (
    (hasInboxLabel(labels) || hasSentLabel(labels)) &&
    !hasSpamLabel(labels) &&
    !hasTrashLabel(labels)
  );
};

export const filterThreadsByScope = (
  threads: readonly MailThreadSummary[],
  accountIds: readonly string[],
  unreadOnly: boolean,
  mailbox: Mailbox = "inbox",
  labelNames: readonly string[] = []
): readonly MailThreadSummary[] =>
  threads.filter(
    ({ accountId, isUnread, labels }) =>
      accountIds.includes(accountId) &&
      threadMatchesMailbox(labels, mailbox) &&
      (!unreadOnly || isUnread) &&
      threadMatchesMailboxLabels(labels, labelNames)
  );

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
  mailbox: Mailbox = "inbox",
  labelNames: readonly string[] = [],
  cursor?: MailThreadCursor
): MailCachedThreadPageRequest => {
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
  mailbox: Mailbox = "inbox",
  labelNames: readonly string[] = []
): string => {
  const normalizedLabelNames = normalizeMailboxLabelSelection(labelNames);

  return `${mailbox}\u0001${unreadOnly ? "unread" : "all"}\u0001${accountIds.join("\u0000")}\u0001${normalizedLabelNames.join("\u0000")}`;
};
