import { useEffect, useState } from "react";

import { getMailApi } from "@/platform/desktop";

export const useSyncingAccountIds = (): readonly string[] => {
  const [accountIds, setAccountIds] = useState<readonly string[]>([]);

  useEffect(() => {
    const mailApi = getMailApi();

    if (mailApi === undefined) {
      return;
    }

    let isActive = true;
    let hasReceivedUpdate = false;
    const unsubscribe = mailApi.onSyncStatusChanged((status) => {
      hasReceivedUpdate = true;
      setAccountIds(status.accountIds);
    });
    const loadStatus = async (): Promise<void> => {
      const status = await mailApi.getSyncStatus();

      if (isActive && !hasReceivedUpdate) {
        setAccountIds(status.accountIds);
      }
    };

    void loadStatus();

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, []);

  return accountIds;
};

export const useIsAccountSyncing = (accountId: string): boolean =>
  useSyncingAccountIds().includes(accountId);
