import { useEffect, useMemo, useState } from "react";

import { getScheduledMailApi } from "@/platform/desktop";
import { useGoogleAccounts } from "@/state/google-accounts";

interface ScheduledTitlebarState {
  readonly attentionCount: number;
  readonly hasScheduledMail: boolean;
}

const EMPTY_STATE: ScheduledTitlebarState = {
  attentionCount: 0,
  hasScheduledMail: false,
};

export const getScheduledTitlebarAccountIds = (
  accounts: readonly { readonly email: string }[]
): readonly string[] => accounts.map(({ email }) => email);

export const useScheduledTitlebarState = (): ScheduledTitlebarState => {
  const accounts = useGoogleAccounts();
  const accountIds = useMemo(
    () => getScheduledTitlebarAccountIds(accounts),
    [accounts]
  );
  const api = useMemo(() => getScheduledMailApi(), []);
  const scopeKey = JSON.stringify(accountIds);
  const [result, setResult] = useState({
    scopeKey,
    state: EMPTY_STATE,
  });

  useEffect(() => {
    if (api === undefined) {
      return;
    }
    let active = true;
    const accountSet = new Set(accountIds);
    const load = async (): Promise<void> => {
      try {
        const reply = await api.getAttentionCount({ accountIds });
        if (active && reply.ok) {
          setResult({
            scopeKey,
            state: {
              attentionCount: reply.data.count,
              hasScheduledMail: reply.data.hasScheduledMail,
            },
          });
        }
      } catch {
        // Keep the previous result. The Scheduled route owns actionable errors.
      }
    };
    void load();
    const unsubscribe = api.onChanged((change) => {
      if (accountSet.has(change.accountId)) {
        void load();
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [accountIds, api, scopeKey]);

  return result.scopeKey === scopeKey ? result.state : EMPTY_STATE;
};
