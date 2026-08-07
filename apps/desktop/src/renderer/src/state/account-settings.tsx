import type { ReactNode } from "react";
import { createContext, use, useEffect, useState } from "react";
import { toast } from "sonner";

import { getSettingsApi } from "@/platform/desktop";
import type {
  AccountSettings,
  AccountSettingsReply,
} from "@/shared/ipc/settings";
import { DEFAULT_ACCOUNT_SETTINGS } from "@/shared/ipc/settings";

const AccountSettingsContext = createContext<readonly AccountSettings[]>([]);

export const AccountSettingsProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [settings, setSettings] = useState<readonly AccountSettings[]>([]);

  useEffect(() => {
    const api = getSettingsApi();

    if (api === undefined) {
      return;
    }

    let isMounted = true;
    const apply = (reply: AccountSettingsReply): void => {
      if (!(isMounted && reply.ok)) {
        return;
      }

      setSettings(reply.data);
    };
    const unsubscribe = api.onAccountSettingsChanged(apply);

    void (async () => {
      try {
        apply(await api.listAccountSettings());
      } catch {
        toast.error("Could not load the account settings");
      }
    })();

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return (
    <AccountSettingsContext value={settings}>{children}</AccountSettingsContext>
  );
};

// Accounts keep the defaults until they are changed, so a missing row is not a
// missing account.
export const useAccountSettings = (accountId: string): AccountSettings =>
  use(AccountSettingsContext).find(
    (entry) => entry.accountId === accountId
  ) ?? {
    ...DEFAULT_ACCOUNT_SETTINGS,
    accountId,
  };
