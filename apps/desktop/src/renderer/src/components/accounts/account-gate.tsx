import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { clearMailboxThreadsSnapshots } from "@/mail/mailbox-cache";
import { getAuthApi } from "@/platform/desktop";
import type { GoogleAccount } from "@/shared/ipc/auth";
import type { AuthGateState } from "@/startup/auth-gate";
import { AccountSettingsProvider } from "@/state/account-settings";
import { AiProviderStateProvider } from "@/state/ai-provider-state";
import { ComposerTemplatesProvider } from "@/state/composer-templates";
import { GmailLabelsProvider } from "@/state/gmail-labels";
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
  const [hasGoogleSetup, setHasGoogleSetup] = useState(false);
  const [isSettingUpGoogle, setIsSettingUpGoogle] = useState(false);
  const [isStartingLogin, setIsStartingLogin] = useState(false);
  const accountOrderVersion = useRef(0);
  const googleSetupVersion = useRef(0);
  const accountIds = useMemo(
    () => accounts.map(({ email }) => email),
    [accounts]
  );

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

  useEffect(() => {
    const auth = getAuthApi();
    const version = googleSetupVersion.current;
    let isActive = true;

    const loadGoogleSetupStatus = async (): Promise<void> => {
      if (auth === undefined) {
        return;
      }

      const reply = await auth.getGoogleOAuthClientStatus();
      if (!isActive || version !== googleSetupVersion.current) {
        return;
      }

      if (reply.ok) {
        setHasGoogleSetup(reply.data);
      } else {
        toast.error(reply.error);
      }
    };

    void loadGoogleSetupStatus();

    return () => {
      isActive = false;
    };
  }, []);

  const setupGoogle = async (): Promise<boolean> => {
    const auth = getAuthApi();

    if (auth === undefined) {
      return false;
    }

    googleSetupVersion.current += 1;
    setIsSettingUpGoogle(true);
    const reply = await auth.setupGoogleOAuthClient();
    setIsSettingUpGoogle(false);

    if (!reply.ok) {
      toast.error(reply.error);
      return false;
    }

    if (reply.data) {
      setHasGoogleSetup(true);
    }
    return reply.data;
  };

  const startLogin = async (): Promise<void> => {
    const auth = getAuthApi();

    if (auth === undefined || !hasGoogleSetup) {
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
    return (
      <LoginScreen
        hasGoogleSetup={hasGoogleSetup}
        isSettingUp={isSettingUpGoogle}
        isStarting={isStartingLogin}
        onLogin={startLogin}
        onSetup={setupGoogle}
      />
    );
  }

  return (
    <GoogleAccountsProvider accounts={accounts} onReorder={reorderAccounts}>
      <AiProviderStateProvider>
        <AccountSettingsProvider>
          <GmailLabelsProvider accountIds={accountIds}>
            <ComposerTemplatesProvider>
              <TrustedImageSendersProvider>
                {children}
              </TrustedImageSendersProvider>
            </ComposerTemplatesProvider>
          </GmailLabelsProvider>
        </AccountSettingsProvider>
      </AiProviderStateProvider>
    </GoogleAccountsProvider>
  );
};

export default AccountGate;
