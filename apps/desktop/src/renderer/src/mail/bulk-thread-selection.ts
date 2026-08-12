import { listUserGmailLabels } from "@/mail/label";
import type {
  GmailLabelColor,
  GmailLabelSummary,
  GmailThreadSummary,
} from "@/shared/ipc/mail";

export interface BulkAccountLabelOption {
  readonly appliedCount: number;
  readonly color?: GmailLabelColor;
  readonly id: string;
  readonly name: string;
}

export interface BulkAccountLabelGroup {
  readonly accountId: string;
  readonly labels: readonly BulkAccountLabelOption[];
  readonly threads: readonly GmailThreadSummary[];
}

/**
 * Gmail label ids belong to one account. Keeping one picker group per selected
 * account makes that ownership visible and scopes each mutation accordingly.
 */
export const getBulkLabelGroups = (
  threads: readonly GmailThreadSummary[],
  catalogs: ReadonlyMap<string, readonly GmailLabelSummary[]>
): readonly BulkAccountLabelGroup[] => {
  const accountThreads = new Map<string, GmailThreadSummary[]>();

  for (const thread of threads) {
    const groupedThreads = accountThreads.get(thread.accountId) ?? [];
    groupedThreads.push(thread);
    accountThreads.set(thread.accountId, groupedThreads);
  }

  return [...accountThreads].map(([accountId, groupedThreads]) => {
    const appliedCounts = new Map<string, number>();

    for (const thread of groupedThreads) {
      for (const label of thread.labels) {
        appliedCounts.set(label, (appliedCounts.get(label) ?? 0) + 1);
      }
    }

    const labels = listUserGmailLabels(catalogs.get(accountId) ?? []).map(
      (label) => ({
        appliedCount: appliedCounts.get(label.name) ?? 0,
        color: label.color,
        id: label.id,
        name: label.name,
      })
    );

    return { accountId, labels, threads: groupedThreads };
  });
};
