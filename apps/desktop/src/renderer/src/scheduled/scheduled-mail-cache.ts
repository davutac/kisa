import type { ScheduledMailSummary } from "@/shared/ipc/scheduled-mail";

export interface ScheduledMailSnapshot {
  readonly accountIds: readonly string[];
  readonly items: readonly ScheduledMailSummary[];
  readonly nextCursor?: string;
  readonly scopeKey: string;
}

const scheduledMailSnapshots = new Map<string, ScheduledMailSnapshot>();

const normalizeAccountIds = (
  accountIds: readonly string[]
): readonly string[] => [...new Set(accountIds)].toSorted();

export const getScheduledMailScopeKey = (
  accountIds: readonly string[]
): string => JSON.stringify(normalizeAccountIds(accountIds));

export const getScheduledMailSnapshot = (
  scopeKey: string
): ScheduledMailSnapshot | undefined => scheduledMailSnapshots.get(scopeKey);

export const setScheduledMailSnapshot = (
  snapshot: ScheduledMailSnapshot
): void => {
  scheduledMailSnapshots.set(snapshot.scopeKey, {
    ...snapshot,
    accountIds: normalizeAccountIds(snapshot.accountIds),
    items: [...snapshot.items],
  });
};

export const invalidateScheduledMailSnapshotsForAccount = (
  accountId: string
): void => {
  for (const [scopeKey, snapshot] of scheduledMailSnapshots) {
    if (snapshot.accountIds.includes(accountId)) {
      scheduledMailSnapshots.delete(scopeKey);
    }
  }
};

export const clearScheduledMailSnapshots = (): void => {
  scheduledMailSnapshots.clear();
};
