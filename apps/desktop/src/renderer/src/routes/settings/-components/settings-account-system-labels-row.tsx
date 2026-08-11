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

interface SettingsAccountSystemLabelsRowProps {
  account: GoogleAccount;
  settingsApi: SettingsApi;
}

const SettingsAccountSystemLabelsRow = ({
  account,
  settingsApi,
}: SettingsAccountSystemLabelsRowProps) => {
  const { showSystemLabels } = useAccountSettings(account.email);
  const [isSaving, setIsSaving] = useState(false);
  const titleId = `account-${account.email}-system-labels-title`;

  const handleChange = async (checked: boolean): Promise<void> => {
    setIsSaving(true);
    try {
      const reply = await settingsApi.updateAccountSettings({
        accountId: account.email,
        showSystemLabels: checked,
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
        <SettingsRowTitle id={titleId}>Gmail system labels</SettingsRowTitle>
        <SettingsRowDescription>
          Show the labels Gmail assigns itself, such as Inbox, Important and the
          category labels, on threads from this account.
        </SettingsRowDescription>
      </SettingsRowContent>
      <SettingsRowActions>
        <Switch
          aria-labelledby={titleId}
          checked={showSystemLabels}
          disabled={isSaving}
          onCheckedChange={(checked) => {
            void handleChange(checked);
          }}
        />
      </SettingsRowActions>
    </SettingsRow>
  );
};

export default SettingsAccountSystemLabelsRow;
