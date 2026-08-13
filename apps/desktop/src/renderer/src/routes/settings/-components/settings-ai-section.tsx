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
import type { AiApi } from "@/platform/desktop";

import AiInstructionsDialog from "./ai-instructions-dialog";
import AiProviderRow from "./ai-provider-row";
import { AI_PROVIDER_ORDER } from "./ai-settings-view";
import { useAiSettings } from "./use-ai-settings";

interface SettingsAiSectionProps {
  readonly aiApi: AiApi;
}

const SettingsAiSection = ({ aiApi }: SettingsAiSectionProps) => {
  const workflow = useAiSettings(aiApi);
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
  const handleReplyInstructionsSave = workflow.setReplyInstructions;
  const handleCleanupInstructionsSave = workflow.setCleanupInstructions;

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
              isLoading={workflow.isLoadingProviders}
              key={provider}
              onSelectModel={(model) => {
                workflow.setProviderModel(provider, model);
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
                Controls how AI drafts replies from the messages in a thread.
              </SettingsRowDescription>
            </SettingsRowContent>
            <SettingsRowActions>
              <AiInstructionsDialog
                description="Customize the system instructions used when Kisa drafts a reply. Thread content is supplied separately."
                onSave={handleReplyInstructionsSave}
                title="Reply instructions"
                value={draft.replyInstructions}
              />
            </SettingsRowActions>
          </SettingsRow>
          <SettingsRow>
            <SettingsRowContent>
              <SettingsRowTitle>Draft cleanup instructions</SettingsRowTitle>
              <SettingsRowDescription>
                Controls how AI improves a new email&apos;s subject and body.
              </SettingsRowDescription>
            </SettingsRowContent>
            <SettingsRowActions>
              <AiInstructionsDialog
                description="Customize the system instructions used when Kisa cleans up a new email draft. Draft content is supplied separately."
                onSave={handleCleanupInstructionsSave}
                title="Draft cleanup instructions"
                value={draft.cleanupInstructions}
              />
            </SettingsRowActions>
          </SettingsRow>
        </SettingsRows>
      </div>
    </SettingsSection>
  );
};

export default SettingsAiSection;
