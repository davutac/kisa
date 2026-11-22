import type {
  MailCachedThreadPageRequest,
  MailboxPlace,
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
import { threadHasMailboxLabel } from "./mailbox-labels";
import { getMailboxPlaceKey, isLabelPlace } from "./mailbox-place";

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

// The same rule as the cache's thread page query, applied to live updates.
// Built once per list, so a label place is recognised once, not per thread.
const toMailboxMatcher = (
  mailbox: MailboxPlace
): ((labels: readonly string[]) => boolean) => {
  if (isLabelPlace(mailbox)) {
    return (labels) =>
      threadHasMailboxLabel(labels, mailbox.label) &&
      !hasSpamLabel(labels) &&
      !hasTrashLabel(labels);
  }
  if (mailbox === "spam") {
    return hasSpamLabel;
  }
  if (mailbox === "trash") {
    return hasTrashLabel;
  }
  if (mailbox === "sent") {
    return (labels) =>
      hasSentLabel(labels) && !hasSpamLabel(labels) && !hasTrashLabel(labels);
  }
  return (labels) =>
    (hasInboxLabel(labels) || hasSentLabel(labels)) &&
    !hasSpamLabel(labels) &&
    !hasTrashLabel(labels);
};

export const filterThreadsByScope = (
  threads: readonly MailThreadSummary[],
  accountIds: readonly string[],
  unreadOnly: boolean,
  mailbox: MailboxPlace = "inbox"
): readonly MailThreadSummary[] => {
  const matchesMailbox = toMailboxMatcher(mailbox);

  return threads.filter(
    ({ accountId, isUnread, labels }) =>
      accountIds.includes(accountId) &&
      matchesMailbox(labels) &&
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
