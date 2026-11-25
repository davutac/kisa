import { RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RadioGroup } from "@/components/ui/radio";
import {
  Settings,
  SettingsRow,
  SettingsRowActions,
  SettingsRowContent,
  SettingsRowDescription,
  SettingsRows,
  settingsRowsClassName,
  SettingsRowTitle,
  SettingsSection,
  SettingsSectionDescription,
  SettingsSectionHeader,
  SettingsSectionTitle,
} from "@/components/ui/settings";
import { cn } from "@/lib/utils";
import {
  DEFAULT_AI_DRAFT_CLEANUP_USER_INSTRUCTIONS,
  DEFAULT_AI_REPLY_USER_INSTRUCTIONS,
} from "@/shared/ai-instructions";

import AiInstructionsDialog from "./ai-instructions-dialog";
import AiProviderRow from "./ai-provider-row";
import { AI_PROVIDER_ORDER } from "./ai-settings-view";
import { toSettingsTarget } from "./settings-search";
import {
  SearchableSettingsRow,
  SearchableSettingsSection,
} from "./settings-search-target";
import { useAiSettings } from "./use-ai-settings";

const SettingsAiPage = () => {
  const workflow = useAiSettings();
  const { draft, settings } = workflow;

  if (settings === null || draft === null) {
    return (
      <Settings>
        <SettingsRows>
          <SettingsRow>
            <SettingsRowContent>
              <SettingsRowTitle>
                {workflow.isLoadingSettings
                  ? "Loading AI settings…"
                  : "AI settings are unavailable"}
              </SettingsRowTitle>
              {workflow.settingsError === null ? null : (
                <SettingsRowDescription role="alert">
                  {workflow.settingsError}
                </SettingsRowDescription>
              )}
            </SettingsRowContent>
            {workflow.isLoadingSettings ? null : (
              <Button
                onClick={() => {
                  void workflow.loadSettings();
                }}
                type="button"
                variant="secondary"
              >
                Try again
              </Button>
            )}
          </SettingsRow>
        </SettingsRows>
      </Settings>
    );
  }

  const providersById = new Map(
    workflow.providers.map((provider) => [provider.provider, provider])
  );
  const handleReplyInstructionsSave = workflow.setReplyUserInstructions;
  const handleCleanupInstructionsSave = workflow.setCleanupUserInstructions;

  return (
    <Settings>
      <SearchableSettingsSection
        aria-labelledby="ai-provider-settings-title"
        target={toSettingsTarget("ai", "provider")}
      >
        <SettingsSectionHeader className="flex-row items-start justify-between gap-4">
          <div className="min-w-0">
            <SettingsSectionTitle id="ai-provider-settings-title">
              Provider
            </SettingsSectionTitle>
            <SettingsSectionDescription className="mt-0.5 pl-5">
              Use an existing CLI subscription for replies, draft cleanup, and
              categorization.
            </SettingsSectionDescription>
          </div>
          <Button
            aria-label="Refresh AI providers"
            className="mt-0.5"
            disabled={workflow.isLoadingProviders}
            onClick={() => {
              void workflow.refreshProviders();
            }}
            size="icon"
            title="Refresh AI providers"
            type="button"
            variant="ghost"
          >
            <RefreshCwIcon
              className={workflow.isLoadingProviders ? "animate-spin" : ""}
            />
          </Button>
        </SettingsSectionHeader>

        <RadioGroup
          aria-label="AI provider used for generation"
          className={cn(settingsRowsClassName, "gap-0")}
          onValueChange={(provider) => {
            if (provider !== null) {
              workflow.setActiveProvider(provider);
            }
          }}
          value={draft.activeProvider}
        >
          {AI_PROVIDER_ORDER.map((provider) => (
            <AiProviderRow
              activeProvider={draft.activeProvider}
              currentModel={draft.providerModels[provider]}
              currentReasoning={draft.providerReasoning[provider]}
              isLoading={workflow.isLoadingProviders}
              key={provider}
              onSelectModel={(model) => {
                workflow.setProviderModel(provider, model);
              }}
              onSelectReasoning={(reasoning) => {
                workflow.setProviderReasoning(provider, reasoning);
              }}
              provider={provider}
              status={providersById.get(provider)}
            />
          ))}
        </RadioGroup>

        {workflow.providersError === null ? null : (
          <p className="text-destructive px-5 text-xs" role="alert">
            {workflow.providersError}
          </p>
        )}
      </SearchableSettingsSection>

      <SettingsSection aria-labelledby="ai-instructions-settings-title">
        <SettingsSectionHeader>
          <SettingsSectionTitle id="ai-instructions-settings-title">
            Instructions
          </SettingsSectionTitle>
        </SettingsSectionHeader>
        <SettingsRows>
          <SearchableSettingsRow
            target={toSettingsTarget("ai", "reply-instructions")}
          >
            <SettingsRowContent>
              <SettingsRowTitle>Reply instructions</SettingsRowTitle>
              <SettingsRowDescription>
                Controls how AI-drafted replies should be written.
              </SettingsRowDescription>
            </SettingsRowContent>
            <SettingsRowActions>
              <AiInstructionsDialog
                description="Set user instructions for writing replies. Kisa's task and output format are fixed system instructions."
                onSave={handleReplyInstructionsSave}
                placeholder={DEFAULT_AI_REPLY_USER_INSTRUCTIONS}
                title="Reply instructions"
                value={draft.replyUserInstructions}
              />
            </SettingsRowActions>
          </SearchableSettingsRow>
          <SearchableSettingsRow
            target={toSettingsTarget("ai", "cleanup-instructions")}
          >
            <SettingsRowContent>
              <SettingsRowTitle>Draft cleanup instructions</SettingsRowTitle>
              <SettingsRowDescription>
                Controls how AI should improve a draft.
              </SettingsRowDescription>
            </SettingsRowContent>
            <SettingsRowActions>
              <AiInstructionsDialog
                description="Set user instructions for cleaning up drafts. Kisa's task and output format are fixed system instructions."
                onSave={handleCleanupInstructionsSave}
                placeholder={DEFAULT_AI_DRAFT_CLEANUP_USER_INSTRUCTIONS}
                title="Draft cleanup instructions"
                value={draft.cleanupUserInstructions}
              />
            </SettingsRowActions>
          </SearchableSettingsRow>
        </SettingsRows>
      </SettingsSection>
    </Settings>
  );
};

export default SettingsAiPage;
