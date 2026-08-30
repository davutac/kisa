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
import { useAiModelSelection } from "@/hooks/use-ai-model-selection";
import type { SettingsApi } from "@/platform/desktop";
import type { GoogleAccount } from "@/shared/ipc/auth";
import { useAccountSettings } from "@/state/account-settings";

interface SettingsAccountCategorizationRowProps {
  account: GoogleAccount;
  settingsApi: SettingsApi;
}

const SettingsAccountCategorizationRow = ({
  account,
  settingsApi,
}: SettingsAccountCategorizationRowProps) => {
  const { categorizationEnabled } = useAccountSettings(account.email);
  const { isLoading, selection } = useAiModelSelection();
  const [isSaving, setIsSaving] = useState(false);
  const titleId = `account-${account.email}-categorization-title`;

  const handleChange = async (checked: boolean): Promise<void> => {
    setIsSaving(true);
    try {
      const reply = await settingsApi.updateAccountSettings({
        accountId: account.email,
        categorizationEnabled: checked,
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
          Automatic categorization
        </SettingsRowTitle>
        <SettingsRowDescription>
          Add up to three existing labels when they are a good fit for a new
          conversation. Kisa sends bounded email context and this account&apos;s
          label names to the AI provider selected above.
        </SettingsRowDescription>
        {categorizationEnabled && !isLoading && selection === null ? (
          <SettingsRowDescription className="text-destructive" role="alert">
            Choose an available AI provider and model above. New conversations
            received while AI is unavailable will not be retried.
          </SettingsRowDescription>
        ) : null}
      </SettingsRowContent>
      <SettingsRowActions>
        <Switch
          aria-labelledby={titleId}
          checked={categorizationEnabled}
          disabled={isSaving}
          onCheckedChange={(checked) => {
            void handleChange(checked);
          }}
        />
      </SettingsRowActions>
    </SettingsRow>
  );
};

export default SettingsAccountCategorizationRow;
