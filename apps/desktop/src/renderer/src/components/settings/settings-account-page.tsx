import AccountProviderIcon from "@/components/accounts/account-provider-icon";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Settings,
  SettingsRows,
  SettingsSection,
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

interface SettingsAccountPageProps {
  account: Account;
  accountsApi: AccountsApi;
  mailApi?: MailApi;
  settingsApi?: SettingsApi;
}

const SettingsAccountPage = ({
  account,
  accountsApi,
  mailApi,
  settingsApi,
}: SettingsAccountPageProps) => {
  const idPrefix = `account-${account.email}`;

  return (
    <Settings>
      <div className="flex min-w-0 items-center gap-3 pl-4 md:pl-5">
        <Avatar aria-hidden="true" size="lg">
          <AvatarFallback>
            <AccountProviderIcon
              className="size-4"
              provider={account.provider}
            />
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col">
          {/* The rows' switches name their account by this id. */}
          <span
            className="truncate text-sm font-semibold"
            id={`${idPrefix}-title`}
          >
            {account.displayName ?? account.email}
          </span>
          {account.displayName === undefined ? null : (
            <span className="text-muted-foreground truncate text-sm">
              {account.email}
            </span>
          )}
        </div>
      </div>

      {settingsApi === undefined ? null : (
        <SettingsSection aria-labelledby={`${idPrefix}-mail-title`}>
          <SettingsSectionHeader>
            <SettingsSectionTitle id={`${idPrefix}-mail-title`}>
              Mail
            </SettingsSectionTitle>
          </SettingsSectionHeader>
          <SettingsRows>
            <SettingsAccountNotificationsRow
              account={account}
              settingsApi={settingsApi}
            />
            <SettingsAccountSignatureRow
              account={account}
              settingsApi={settingsApi}
            />
            <SettingsAccountCategorizationRow
              account={account}
              settingsApi={settingsApi}
            />
          </SettingsRows>
        </SettingsSection>
      )}

      {mailApi === undefined && settingsApi === undefined ? null : (
        <SettingsSection aria-labelledby={`${idPrefix}-labels-title`}>
          <SettingsSectionHeader>
            <SettingsSectionTitle id={`${idPrefix}-labels-title`}>
              Labels
            </SettingsSectionTitle>
          </SettingsSectionHeader>
          <SettingsRows>
            {mailApi === undefined ? null : (
              <SettingsAccountLabelsRow
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
          </SettingsRows>
        </SettingsSection>
      )}

      {mailApi === undefined ? null : (
        <SettingsSection aria-labelledby={`${idPrefix}-sync-title`}>
          <SettingsSectionHeader>
            <SettingsSectionTitle id={`${idPrefix}-sync-title`}>
              Sync
            </SettingsSectionTitle>
          </SettingsSectionHeader>
          <SettingsRows>
            <SettingsAccountReindexRow
              accountId={account.email}
              accountsApi={accountsApi}
              mailApi={mailApi}
            />
          </SettingsRows>
        </SettingsSection>
      )}

      <SettingsRows>
        <SettingsAccountDisconnectRow
          account={account}
          accountsApi={accountsApi}
        />
      </SettingsRows>
    </Settings>
  );
};

export default SettingsAccountPage;
