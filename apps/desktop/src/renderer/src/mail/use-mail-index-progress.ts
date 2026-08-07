import { useEffect, useState } from "react";

import { advanceEtas } from "@/mail/mail-index-eta";
import type { AccountSamples } from "@/mail/mail-index-eta";
import { getMailApi } from "@/platform/desktop";
import type { GmailIndexProgress } from "@/shared/ipc/mail";

export interface MailIndexState {
  readonly accounts: readonly GmailIndexProgress[];
  /** Remaining time per account, in milliseconds. Absent until measurable. */
  readonly etas: ReadonlyMap<string, number>;
}

const EMPTY_STATE: MailIndexState = { accounts: [], etas: new Map() };

/**
 * Progress for the full-account mail index, with a remaining-time estimate.
 *
 * Deliberately separate from `useSyncingAccountIds`: the two answer different
 * questions. Sync status is "is this account checking for new mail right now",
 * which flickers every 15 seconds; this is "how much of the mailbox has been
 * indexed", which advances slowly and is worth showing as a proportion.
 *
 * The estimate is folded in inside the subscription callback rather than in an
 * effect or during render. A progress event is exactly the external event this
 * hook exists to synchronise with, so that is the one place where measuring the
 * clock is legitimate — deriving it later would either read a ref during render
 * or cascade an extra render per tick.
 */
export const useMailIndexState = (): MailIndexState => {
  const [state, setState] = useState<MailIndexState>(EMPTY_STATE);

  useEffect(() => {
    const mailApi = getMailApi();

    if (mailApi === undefined) {
      return;
    }

    let isActive = true;
    let hasReceivedUpdate = false;
    // Owned by this subscription, so unmounting discards the measurement along
    // with the listener that feeds it.
    const samples = new Map<string, AccountSamples>();
    const apply = (accounts: readonly GmailIndexProgress[]): void => {
      setState({ accounts, etas: advanceEtas(samples, accounts, Date.now()) });
    };
    const unsubscribe = mailApi.onIndexProgressChanged((progress) => {
      hasReceivedUpdate = true;
      apply(progress.accounts);
    });
    const loadProgress = async (): Promise<void> => {
      const progress = await mailApi.getIndexProgress();

      // A push that landed while the initial read was in flight is newer than
      // the read, so it must not be overwritten by it.
      if (isActive && !hasReceivedUpdate) {
        apply(progress.accounts);
      }
    };

    void loadProgress();

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, []);

  return state;
};

export const useMailIndexProgress = (): readonly GmailIndexProgress[] =>
  useMailIndexState().accounts;

export const useAccountIndexProgress = (
  accountId: string
): GmailIndexProgress | undefined =>
  useMailIndexProgress().find((entry) => entry.accountId === accountId);

/** True while any of the given accounts is still being indexed. */
export const useIsIndexing = (accountIds: readonly string[]): boolean => {
  const progress = useMailIndexProgress();

  return progress.some(
    (entry) =>
      entry.status === "running" && accountIds.includes(entry.accountId)
  );
};
