import type { AccountsApi, MailApi, SettingsApi } from "@/platform/desktop";
import { useAccounts } from "@/state/accounts";

import SettingsAccountSection from "./settings-account-section";

interface SettingsAccountsSectionProps {
  accountsApi: AccountsApi;
  mailApi?: MailApi;
  settingsApi?: SettingsApi;
}

const SettingsAccountsSection = ({
  accountsApi,
  mailApi,
  settingsApi,
}: SettingsAccountsSectionProps) => {
  const accounts = useAccounts();

  return accounts.map((account) => (
    <SettingsAccountSection
      account={account}
      accountsApi={accountsApi}
      key={account.email}
      mailApi={mailApi}
      settingsApi={settingsApi}
    />
  ));
};

export default SettingsAccountsSection;
