import { useState } from "react";

import {
  SettingsRowActions,
  SettingsRowContent,
  SettingsRowDescription,
  SettingsRowTitle,
} from "@/components/ui/settings";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { useAiModelSelection } from "@/hooks/use-ai-model-selection";
import { runWithCleanup } from "@/lib/run-with-cleanup";
import type { SettingsApi } from "@/platform/desktop";
import type { Account } from "@/shared/ipc/accounts";
import { useAccountSettings } from "@/state/account-settings";

import { toAccountSettingsPage } from "./settings-pages";
import { toSettingsTarget } from "./settings-search";
import { SearchableSettingsRow } from "./settings-search-target";

interface SettingsAccountCategorizationRowProps {
  account: Account;
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
    await runWithCleanup(
      async () => {
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
        "categorization"
      )}
    >
      <SettingsRowContent>
        <SettingsRowTitle id={titleId}>
          Automatic categorization
        </SettingsRowTitle>
        <SettingsRowDescription>
          Add up to three existing labels when they are a good fit for a new
          conversation. Kisa sends bounded email context and this account&apos;s
          label names to the AI provider chosen in AI writing.
        </SettingsRowDescription>
        {categorizationEnabled && !isLoading && selection === null ? (
          <SettingsRowDescription className="text-destructive" role="alert">
            Choose an available AI provider and model in AI writing. New
            conversations received while AI is unavailable will not be retried.
          </SettingsRowDescription>
        ) : null}
      </SettingsRowContent>
      <SettingsRowActions>
        <Switch
          aria-labelledby={`${titleId} account-${account.email}-title`}
          checked={categorizationEnabled}
          disabled={isSaving}
          onCheckedChange={(checked) => {
            void handleChange(checked);
          }}
        />
      </SettingsRowActions>
    </SearchableSettingsRow>
  );
};

export default SettingsAccountCategorizationRow;
