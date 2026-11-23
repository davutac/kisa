import { useEffect, useMemo, useRef, useState } from "react";

import { toast } from "@/components/ui/toast";
import { clearMailboxThreadsSnapshots } from "@/mail/mailbox-cache";
import { getAccountsApi } from "@/platform/desktop";
import { clearScheduledMailSnapshots } from "@/scheduled/scheduled-mail-cache";
import type { Account } from "@/shared/ipc/accounts";
import type { AuthGateState } from "@/startup/auth-gate";
import { AccountSettingsProvider } from "@/state/account-settings";
import { AccountsProvider } from "@/state/accounts";
import { AiProviderStateProvider } from "@/state/ai-provider-state";
import { ComposerTemplatesProvider } from "@/state/composer-templates";
import { LabelsProvider } from "@/state/labels";
import { useMailboxStore } from "@/state/mailbox";
import { TrustedImageSendersProvider } from "@/state/trusted-image-senders";

import LoginScreen from "./login-screen";

interface AccountGateProps {
  children: React.ReactNode;
  initialState: AuthGateState;
}

// A disconnected account leaves the mailbox scoped to something that no longer
// exists, which reads as an empty inbox rather than as a removed account.
const dropDisconnectedAccountSelection = (
  accounts: readonly Account[]
): void => {
  const { selectAccount, selectedAccountId } = useMailboxStore.getState();

  if (
    selectedAccountId !== null &&
    !accounts.some(({ email }) => email === selectedAccountId)
  ) {
    selectAccount(null);
  }
};

const AccountGate = ({ children, initialState }: AccountGateProps) => {
  const [accounts, setAccounts] = useState<readonly Account[]>(
    initialState.status === "authenticated" ? initialState.accounts : []
  );
  const [isAuthenticated, setIsAuthenticated] = useState(
    initialState.status === "authenticated"
  );
  const accountOrderVersion = useRef(0);
  const accountIds = useMemo(
    () => accounts.map(({ email }) => email),
    [accounts]
  );

  const reorderAccounts = async (
    reorderedAccounts: readonly Account[]
  ): Promise<void> => {
    const accountsApi = getAccountsApi();

    if (accountsApi === undefined) {
      return;
    }

    const version = accountOrderVersion.current + 1;
    accountOrderVersion.current = version;
    const previousAccounts = accounts;
    setAccounts(reorderedAccounts);
    const reply = await accountsApi.reorderAccounts({
      emails: reorderedAccounts.map(({ email }) => email),
    });

    if (reply.ok || version !== accountOrderVersion.current) {
      return;
    }

    toast.error(reply.error);
    const refreshed = await accountsApi.listAccounts();
    setAccounts(refreshed.ok ? refreshed.data : previousAccounts);
  };

  useEffect(
    () =>
      // The only path from the login screen to the mailbox: main announces the
      // new list once the Add account window saves an account.
      getAccountsApi()?.onAccountsChanged((reply) => {
        if (!reply.ok) {
          toast.error(reply.error);
          return;
        }

        clearMailboxThreadsSnapshots();
        clearScheduledMailSnapshots();
        dropDisconnectedAccountSelection(reply.data);
        setAccounts(reply.data);
        setIsAuthenticated(reply.data.length > 0);
      }),
    []
  );

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <AccountsProvider accounts={accounts} onReorder={reorderAccounts}>
      <AiProviderStateProvider>
        <AccountSettingsProvider>
          <LabelsProvider accountIds={accountIds}>
            <ComposerTemplatesProvider>
              <TrustedImageSendersProvider>
                {children}
              </TrustedImageSendersProvider>
            </ComposerTemplatesProvider>
          </LabelsProvider>
        </AccountSettingsProvider>
      </AiProviderStateProvider>
    </AccountsProvider>
  );
};

export default AccountGate;
