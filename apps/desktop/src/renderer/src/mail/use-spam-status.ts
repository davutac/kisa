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

    // The scope key, not the caller's array, drives the effect: callers may
    // build a new array on every render, and re-running on each one would
    // request the status again and render again without end.
    const scopeAccountIds = scopeKey === "" ? [] : scopeKey.split("\u0000");
    let isActive = true;
    let requestRevision = 0;
    const load = async (): Promise<void> => {
      const revision = requestRevision + 1;
      requestRevision = revision;
      const reply = await mailApi.getSpamStatus({
        accountIds: scopeAccountIds,
      });

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

          return scopeAccountIds.includes(accountId);
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
  }, [scopeKey]);

  return status.scopeKey === scopeKey && status.hasUnreadSpam;
};
