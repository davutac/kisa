import { useState } from "react";

import {
  SettingsRowActions,
  SettingsRowContent,
  SettingsRowDescription,
  SettingsRowTitle,
} from "@/components/ui/settings";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { runWithCleanup } from "@/lib/run-with-cleanup";
import type { SettingsApi } from "@/platform/desktop";
import type { Account } from "@/shared/ipc/accounts";
import { useAccountSettings } from "@/state/account-settings";

import { toAccountSettingsPage } from "./settings-pages";
import { toSettingsTarget } from "./settings-search";
import { SearchableSettingsRow } from "./settings-search-target";

interface SettingsAccountNotificationsRowProps {
  account: Account;
  settingsApi: SettingsApi;
}

const SettingsAccountNotificationsRow = ({
  account,
  settingsApi,
}: SettingsAccountNotificationsRowProps) => {
  const { notificationsEnabled } = useAccountSettings(account.email);
  const [isSaving, setIsSaving] = useState(false);
  const titleId = `account-${account.email}-notifications-title`;

  const handleChange = async (checked: boolean): Promise<void> => {
    setIsSaving(true);
    await runWithCleanup(
      async () => {
        try {
          const reply = await settingsApi.updateAccountSettings({
            accountId: account.email,
            notificationsEnabled: checked,
          });

          if (!reply.ok) {
            toast.error(reply.error);
          }
        } catch {
          toast.error("Could not save the setting", {
            description: "Please try again.",
          });
        }
      },
      () => {
        setIsSaving(false);
      }
    );
  };

  return (
    <SearchableSettingsRow
      target={toSettingsTarget(
        toAccountSettingsPage(account.email),
        "notifications"
      )}
    >
      <SettingsRowContent>
        <SettingsRowTitle id={titleId}>
          New email notifications
        </SettingsRowTitle>
        <SettingsRowDescription>
          Show a system notification when new unread mail arrives for this
          account.
        </SettingsRowDescription>
      </SettingsRowContent>
      <SettingsRowActions>
        <Switch
          aria-labelledby={`${titleId} account-${account.email}-title`}
          checked={notificationsEnabled}
          disabled={isSaving}
          onCheckedChange={(checked) => {
            void handleChange(checked);
          }}
        />
      </SettingsRowActions>
    </SearchableSettingsRow>
  );
};

export default SettingsAccountNotificationsRow;
