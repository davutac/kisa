import { useState } from "react";

import {
  SettingsRow,
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

interface SettingsAccountSystemLabelsRowProps {
  account: Account;
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
    await runWithCleanup(
      async () => {
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
        }
      },
      () => {
        setIsSaving(false);
      }
    );
  };

  return (
    <SettingsRow>
      <SettingsRowContent>
        <SettingsRowTitle id={titleId}>System labels</SettingsRowTitle>
        <SettingsRowDescription>
          Show the labels your mail service assigns itself, such as Inbox, Sent
          and Important, on threads from this account.
        </SettingsRowDescription>
      </SettingsRowContent>
      <SettingsRowActions>
        <Switch
          aria-labelledby={`${titleId} account-${account.email}-title`}
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
