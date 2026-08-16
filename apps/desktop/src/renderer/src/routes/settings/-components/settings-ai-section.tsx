import { RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RadioGroup } from "@/components/ui/radio-group";
import {
  SettingsRow,
  SettingsRowActions,
  SettingsRowContent,
  SettingsRowDescription,
  SettingsRows,
  SettingsRowTitle,
  SettingsSection,
  SettingsSectionDescription,
  SettingsSectionHeader,
  SettingsSectionTitle,
} from "@/components/ui/settings";
import {
  DEFAULT_AI_DRAFT_CLEANUP_USER_INSTRUCTIONS,
  DEFAULT_AI_REPLY_USER_INSTRUCTIONS,
} from "@/shared/ai-instructions";

import AiInstructionsDialog from "./ai-instructions-dialog";
import AiProviderRow from "./ai-provider-row";
import { AI_PROVIDER_ORDER } from "./ai-settings-view";
import { useAiSettings } from "./use-ai-settings";

const SettingsAiSection = () => {
  const workflow = useAiSettings();
  const { draft, settings } = workflow;

  if (settings === null || draft === null) {
    return (
      <SettingsSection aria-labelledby="ai-settings-title">
        <SettingsSectionHeader>
          <SettingsSectionTitle id="ai-settings-title">
            AI writing
          </SettingsSectionTitle>
        </SettingsSectionHeader>
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
      </SettingsSection>
    );
  }

  const providersById = new Map(
    workflow.providers.map((provider) => [provider.provider, provider])
  );
  const handleReplyInstructionsSave = workflow.setReplyUserInstructions;
  const handleCleanupInstructionsSave = workflow.setCleanupUserInstructions;

  return (
    <SettingsSection aria-labelledby="ai-settings-title">
      <SettingsSectionHeader className="flex-row items-start justify-between gap-4">
        <div className="min-w-0">
          <SettingsSectionTitle id="ai-settings-title">
            AI writing
          </SettingsSectionTitle>
          <SettingsSectionDescription className="mt-0.5 pl-5">
            Use an existing CLI subscription for replies and draft cleanup.
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

      <div className="flex flex-col gap-4">
        <RadioGroup
          aria-label="AI provider used for generation"
          className="bg-background gap-px overflow-hidden rounded-lg"
          onValueChange={(provider) => {
            if (
              provider === "codex" ||
              provider === "claude" ||
              provider === "opencode"
            ) {
              workflow.setActiveProvider(provider);
            }
          }}
          value={draft.activeProvider ?? ""}
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
          <p className="text-destructive px-4 text-xs" role="alert">
            {workflow.providersError}
          </p>
        )}

        <SettingsRows>
          <SettingsRow>
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
          </SettingsRow>
          <SettingsRow>
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
          </SettingsRow>
        </SettingsRows>
      </div>
    </SettingsSection>
  );
};

export default SettingsAiSection;
