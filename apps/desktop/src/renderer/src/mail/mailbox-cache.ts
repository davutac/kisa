import type { GmailThreadCursor, GmailThreadSummary } from "@/shared/ipc/mail";

import type { ThreadPatch } from "./mailbox-model";
import { patchThreads } from "./mailbox-model";

export interface MailboxThreadsSnapshot {
  cacheCursor: GmailThreadCursor | null;
  isInitialLoading: boolean;
  isLoadingNextPage: boolean;
  scopeKey: string;
  threads: readonly GmailThreadSummary[];
}

// Keyed by mailbox scope alone: the list has no query of its own now that
// searching lives in the palette.
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

// Every scope is patched, not just the visible one: snapshots are merged into
// rather than replaced on their next load, so a scope that missed the edit
// would hand the stale thread back the moment it is opened.
export const patchMailboxThreadsSnapshots = (
  threadKey: string,
  patch: ThreadPatch
): void => {
  for (const [key, snapshot] of mailboxSnapshots) {
    mailboxSnapshots.set(key, {
      ...snapshot,
      threads: patchThreads(snapshot.threads, threadKey, patch),
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
    const separatorIndex = snapshot.scopeKey.indexOf("\u0001");
    const snapshotAccountIds = snapshot.scopeKey
      .slice(separatorIndex + 1)
      .split("\u0000")
      .filter((accountId) => accountId.length > 0);
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
