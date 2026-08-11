import { useCallback, useEffect, useState } from "react";

import { getMailApi } from "@/platform/desktop";

interface SpamStatus {
  hasNewSpam: boolean;
  markSeen: () => Promise<void>;
}

/** Account-scoped new-Spam state, refreshed by the shared thread event stream. */
export const useSpamStatus = (accountIds: readonly string[]): SpamStatus => {
  const scopeKey = accountIds.join("\u0000");
  const [status, setStatus] = useState({
    hasNewSpam: false,
    scopeKey,
  });

  useEffect(() => {
    const mailApi = getMailApi();

    if (mailApi === undefined) {
      return;
    }

    let isActive = true;
    let requestRevision = 0;
    const load = async (): Promise<void> => {
      const revision = requestRevision + 1;
      requestRevision = revision;
      const reply = await mailApi.getSpamStatus({ accountIds });

      if (isActive && requestRevision === revision && reply.ok) {
        setStatus({ hasNewSpam: reply.data.hasNewSpam, scopeKey });
      }
    };
    const unsubscribe = mailApi.onThreadListUpdated(({ changes }) => {
      if (
        changes.some((change) => {
          const accountId =
            change.kind === "upsert"
              ? change.thread.accountId
              : change.accountId;

          return accountIds.includes(accountId);
        })
      ) {
        void load();
      }
    });

    void load();

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [accountIds, scopeKey]);

  const markSeen = useCallback(async (): Promise<void> => {
    const mailApi = getMailApi();

    if (mailApi === undefined) {
      return;
    }

    const reply = await mailApi.markSpamSeen({ accountIds });

    if (reply.ok) {
      setStatus({ hasNewSpam: reply.data.hasNewSpam, scopeKey });
    }
  }, [accountIds, scopeKey]);

  return {
    hasNewSpam: status.scopeKey === scopeKey && status.hasNewSpam,
    markSeen,
  };
};
