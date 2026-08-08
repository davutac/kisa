import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { clearMailboxThreadsSnapshots } from "@/mail/mailbox-cache";
import { getAuthApi } from "@/platform/desktop";
import type { GoogleAccount } from "@/shared/ipc/auth";
import type { AuthGateState } from "@/startup/auth-gate";
import { AccountSettingsProvider } from "@/state/account-settings";
import { GoogleAccountsProvider } from "@/state/google-accounts";
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
  accounts: readonly GoogleAccount[]
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
  const [accounts, setAccounts] = useState<readonly GoogleAccount[]>(
    initialState.status === "authenticated" ? initialState.accounts : []
  );
  const [isAuthenticated, setIsAuthenticated] = useState(
    initialState.status === "authenticated"
  );
  const [isStartingLogin, setIsStartingLogin] = useState(false);
  const accountOrderVersion = useRef(0);

  const reorderAccounts = async (
    reorderedAccounts: readonly GoogleAccount[]
  ): Promise<void> => {
    const auth = getAuthApi();

    if (auth === undefined) {
      return;
    }

    const version = accountOrderVersion.current + 1;
    accountOrderVersion.current = version;
    const previousAccounts = accounts;
    setAccounts(reorderedAccounts);
    const reply = await auth.reorderGoogleAccounts({
      emails: reorderedAccounts.map(({ email }) => email),
    });

    if (reply.ok || version !== accountOrderVersion.current) {
      return;
    }

    toast.error(reply.error);
    const refreshed = await auth.listGoogleAccounts();
    setAccounts(refreshed.ok ? refreshed.data : previousAccounts);
  };

  useEffect(() => {
    const auth = getAuthApi();

    return auth?.onGoogleAccountsChanged((reply) => {
      setIsStartingLogin(false);

      if (!reply.ok) {
        toast.error(reply.error);
        return;
      }

      clearMailboxThreadsSnapshots();
      dropDisconnectedAccountSelection(reply.data);
      setAccounts(reply.data);
      setIsAuthenticated(reply.data.length > 0);
    });
  }, []);

  const startLogin = async (): Promise<void> => {
    const auth = getAuthApi();

    if (auth === undefined) {
      return;
    }

    setIsStartingLogin(true);
    const reply = await auth.startGoogle();

    if (!reply.ok) {
      setIsStartingLogin(false);
      toast.error(reply.error);
    }
  };

  if (!isAuthenticated) {
    return <LoginScreen isStarting={isStartingLogin} onLogin={startLogin} />;
  }

  return (
    <GoogleAccountsProvider accounts={accounts} onReorder={reorderAccounts}>
      <AccountSettingsProvider>
        <TrustedImageSendersProvider>{children}</TrustedImageSendersProvider>
      </AccountSettingsProvider>
    </GoogleAccountsProvider>
  );
};

export default AccountGate;
