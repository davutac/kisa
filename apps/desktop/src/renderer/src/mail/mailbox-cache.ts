import type {
  MailThreadCursor,
  MailThreadListChange,
  MailThreadSummary,
} from "@/shared/ipc/mail";

import {
  applyThreadListChanges,
  getThreadListChangeAccountId,
} from "./mailbox-model";

export interface MailboxThreadsSnapshot {
  cacheCursor: MailThreadCursor | null;
  isInitialLoading: boolean;
  isLoadingNextPage: boolean;
  scopeKey: string;
  threads: readonly MailThreadSummary[];
}

// Keyed by mailbox scope alone: the list has no query of its own now that
// searching lives in the inline mailbox search session.
const mailboxSnapshots = new Map<string, MailboxThreadsSnapshot>();

export const getMailboxThreadsSnapshot = (
  key: string
): MailboxThreadsSnapshot | undefined => {
  const snapshot = mailboxSnapshots.get(key);

  if (snapshot === undefined) {
    return undefined;
  }

  return snapshot;
};

export const setMailboxThreadsSnapshot = (
  key: string,
  snapshot: MailboxThreadsSnapshot
): void => {
  mailboxSnapshots.set(key, { ...snapshot, isLoadingNextPage: false });
};

// Every relevant scope receives the same IPC change set, not just the visible
// one. That prevents a stale snapshot from restoring an old projection later
// and lets incoming threads appear without reloading a whole first page.
const getSnapshotAccountIds = (snapshot: MailboxThreadsSnapshot): string[] => {
  const accountSegment = snapshot.scopeKey.split("\u0001")[2] ?? "";

  return accountSegment
    .split("\u0000")
    .filter((accountId) => accountId.length > 0);
};

export const updateMailboxThreadsSnapshots = (
  changes: readonly MailThreadListChange[]
): void => {
  for (const [key, snapshot] of mailboxSnapshots) {
    const accountIds = getSnapshotAccountIds(snapshot);

    const relevantChanges = changes.filter((change) =>
      accountIds.includes(getThreadListChangeAccountId(change))
    );

    if (relevantChanges.length === 0) {
      continue;
    }

    mailboxSnapshots.set(key, {
      ...snapshot,
      threads: applyThreadListChanges(snapshot.threads, relevantChanges),
    });
  }
};

export const clearMailboxThreadsSnapshots = (): void => {
  mailboxSnapshots.clear();
};

export const retainMailboxThreadsSnapshotsForAccounts = (
  accountIds: readonly string[]
): void => {
  const retainedAccountIds = new Set(accountIds);

  for (const [key, snapshot] of mailboxSnapshots) {
    const snapshotAccountIds = getSnapshotAccountIds(snapshot);

    const matchesAccounts =
      snapshotAccountIds.length === retainedAccountIds.size &&
      snapshotAccountIds.every((accountId) =>
        retainedAccountIds.has(accountId)
      );

    if (!matchesAccounts) {
      mailboxSnapshots.delete(key);
    }
  }
};
