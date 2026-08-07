import { useEffect, useState } from "react";
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
    <GoogleAccountsProvider accounts={accounts}>
      <AccountSettingsProvider>
        <TrustedImageSendersProvider>{children}</TrustedImageSendersProvider>
      </AccountSettingsProvider>
    </GoogleAccountsProvider>
  );
};

export default AccountGate;
