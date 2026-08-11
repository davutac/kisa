import { useState } from "react";
import { toast } from "sonner";

import {
  SettingsRow,
  SettingsRowActions,
  SettingsRowContent,
  SettingsRowDescription,
  SettingsRowTitle,
} from "@/components/ui/settings";
import { Switch } from "@/components/ui/switch";
import type { SettingsApi } from "@/platform/desktop";
import type { GoogleAccount } from "@/shared/ipc/auth";
import { useAccountSettings } from "@/state/account-settings";

interface SettingsAccountNotificationsRowProps {
  account: GoogleAccount;
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
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SettingsRow>
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
          aria-labelledby={titleId}
          checked={notificationsEnabled}
          disabled={isSaving}
          onCheckedChange={(checked) => {
            void handleChange(checked);
          }}
        />
      </SettingsRowActions>
    </SettingsRow>
  );
};

export default SettingsAccountNotificationsRow;
