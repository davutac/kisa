import { useEffect, useState } from "react";

import { getMailApi } from "@/platform/desktop";

/** Account-scoped unread Spam state, refreshed by the thread event stream. */
export const useHasUnreadSpam = (accountIds: readonly string[]): boolean => {
  const scopeKey = accountIds.join("\u0000");
  const [status, setStatus] = useState({
    hasUnreadSpam: false,
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
        setStatus({ hasUnreadSpam: reply.data.hasUnreadSpam, scopeKey });
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

  return status.scopeKey === scopeKey && status.hasUnreadSpam;
};
