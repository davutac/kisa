import type { MailApi } from "@/platform/desktop";
import type { MailUnreadLabels } from "@/shared/ipc/mail";

import { normalizeMailboxLabelName } from "./mailbox-labels";
import { useScopeRead } from "./use-scope-read";

export interface UnreadLabelCounts {
  /** Per account, unread conversations carrying any user label, once each. */
  readonly accounts: ReadonlyMap<string, number>;
  /** Unread conversations on each label's place, by `toUnreadLabelKey`. */
  readonly labels: ReadonlyMap<string, number>;
}

const NONE: UnreadLabelCounts = { accounts: new Map(), labels: new Map() };

/** One account's label, folded as the label catalog folds names. */
export const toUnreadLabelKey = (accountId: string, label: string): string =>
  `${accountId}\u0000${normalizeMailboxLabelName(label)}`;

/**
 * Paths that fold to one key are one label to the catalog, and its place
 * lists both, so their counts add up.
 */
export const toUnreadLabelCounts = ({
  accounts,
  labels,
}: MailUnreadLabels): UnreadLabelCounts => {
  const byLabel = new Map<string, number>();

  for (const { accountId, count, label } of labels) {
    const key = toUnreadLabelKey(accountId, label);
    byLabel.set(key, (byLabel.get(key) ?? 0) + count);
  }

  return {
    accounts: new Map(
      accounts.map(({ accountId, count }) => [accountId, count])
    ),
    labels: byLabel,
  };
};

const readUnreadLabelCounts = async (
  mailApi: MailApi,
  accountIds: readonly string[]
): Promise<UnreadLabelCounts | undefined> => {
  const reply = await mailApi.getUnreadLabels({ accountIds });
  return reply.ok ? toUnreadLabelCounts(reply.data) : undefined;
};

/**
 * Unread conversations on the given accounts' label places. The read walks
 * every unread conversation's labels, so a burst of thread events costs one
 * more read rather than one each.
 */
export const useUnreadLabels = (
  accountIds: readonly string[]
): UnreadLabelCounts => useScopeRead(accountIds, NONE, readUnreadLabelCounts);
