import type { AuthApi, MailApi, SettingsApi } from "@/platform/desktop";
import { useGoogleAccounts } from "@/state/google-accounts";

import SettingsAccountSection from "./settings-account-section";

interface SettingsAccountsSectionProps {
  authApi: AuthApi;
  mailApi?: MailApi;
  settingsApi?: SettingsApi;
}

const SettingsAccountsSection = ({
  authApi,
  mailApi,
  settingsApi,
}: SettingsAccountsSectionProps) => {
  const accounts = useGoogleAccounts();

  return accounts.map((account) => (
    <SettingsAccountSection
      account={account}
      authApi={authApi}
      key={account.email}
      mailApi={mailApi}
      settingsApi={settingsApi}
    />
  ));
};

export default SettingsAccountsSection;
