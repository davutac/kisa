import { UserRoundIcon } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  SettingsRows,
  SettingsSection,
  SettingsSectionDescription,
  SettingsSectionHeader,
  SettingsSectionTitle,
} from "@/components/ui/settings";
import type { AccountsApi, MailApi, SettingsApi } from "@/platform/desktop";
import type { Account } from "@/shared/ipc/accounts";

import SettingsAccountCategorizationRow from "./settings-account-categorization-row";
import SettingsAccountDisconnectRow from "./settings-account-disconnect-row";
import SettingsAccountLabelsRow from "./settings-account-labels-row";
import SettingsAccountNotificationsRow from "./settings-account-notifications-row";
import SettingsAccountReindexRow from "./settings-account-reindex-row";
import SettingsAccountSignatureRow from "./settings-account-signature-row";
import SettingsAccountSystemLabelsRow from "./settings-account-system-labels-row";

interface SettingsAccountSectionProps {
  account: Account;
  accountsApi: AccountsApi;
  mailApi?: MailApi;
  settingsApi?: SettingsApi;
}

const SettingsAccountSection = ({
  account,
  accountsApi,
  mailApi,
  settingsApi,
}: SettingsAccountSectionProps) => {
  const titleId = `account-${account.email}-title`;

  return (
    <SettingsSection aria-labelledby={titleId}>
      <SettingsSectionHeader>
        <div className="flex min-w-0 items-center gap-3 pl-4 md:pl-5">
          <Avatar size="lg">
            <AvatarFallback>
              <UserRoundIcon aria-hidden="true" className="size-4" />
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-0">
            <SettingsSectionTitle
              className="truncate pl-0 leading-tight"
              id={titleId}
            >
              {account.displayName ?? account.email}
            </SettingsSectionTitle>
            {account.displayName === undefined ? null : (
              <SettingsSectionDescription className="truncate">
                {account.email}
              </SettingsSectionDescription>
            )}
          </div>
        </div>
      </SettingsSectionHeader>
      <SettingsRows>
        {settingsApi === undefined ? null : (
          <SettingsAccountNotificationsRow
            account={account}
            settingsApi={settingsApi}
          />
        )}
        {settingsApi === undefined ? null : (
          <SettingsAccountCategorizationRow
            account={account}
            settingsApi={settingsApi}
          />
        )}
        {settingsApi === undefined ? null : (
          <SettingsAccountSignatureRow
            account={account}
            settingsApi={settingsApi}
          />
        )}
        {mailApi === undefined ? null : (
          <SettingsAccountLabelsRow
            accountId={account.email}
            mailApi={mailApi}
          />
        )}
        {mailApi === undefined ? null : (
          <SettingsAccountReindexRow
            accountId={account.email}
            mailApi={mailApi}
          />
        )}
        {settingsApi === undefined ? null : (
          <SettingsAccountSystemLabelsRow
            account={account}
            settingsApi={settingsApi}
          />
        )}
        <SettingsAccountDisconnectRow
          account={account}
          accountsApi={accountsApi}
        />
      </SettingsRows>
    </SettingsSection>
  );
};

export default SettingsAccountSection;
