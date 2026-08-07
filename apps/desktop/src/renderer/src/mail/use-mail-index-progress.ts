import { useEffect, useState } from "react";

import { getMailApi } from "@/platform/desktop";
import type { GmailIndexProgress } from "@/shared/ipc/mail";

const EMPTY: readonly GmailIndexProgress[] = [];

/**
 * Progress for the full-account mail index, one entry per account.
 *
 * Deliberately separate from `useSyncingAccountIds`: the two answer different
 * questions. Sync status is "is this account checking for new mail right now",
 * which flickers every 15 seconds; this is "how much of the mailbox has been
 * indexed", which advances slowly and is worth showing as a proportion.
 */
export const useMailIndexProgress = (): readonly GmailIndexProgress[] => {
  const [accounts, setAccounts] =
    useState<readonly GmailIndexProgress[]>(EMPTY);

  useEffect(() => {
    const mailApi = getMailApi();

    if (mailApi === undefined) {
      return;
    }

    let isActive = true;
    let hasReceivedUpdate = false;
    const unsubscribe = mailApi.onIndexProgressChanged((progress) => {
      hasReceivedUpdate = true;
      setAccounts(progress.accounts);
    });
    const loadProgress = async (): Promise<void> => {
      const progress = await mailApi.getIndexProgress();

      // A push that landed while the initial read was in flight is newer than
      // the read, so it must not be overwritten by it.
      if (isActive && !hasReceivedUpdate) {
        setAccounts(progress.accounts);
      }
    };

    void loadProgress();

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, []);

  return accounts;
};

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
