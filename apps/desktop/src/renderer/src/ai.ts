import type {
  AiModelSelection,
  AiProvider,
  AiProviderStatus,
  AiSettings,
} from "@/shared/ipc/ai";

export const AI_PROVIDER_NAMES = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
} satisfies Record<AiProvider, string>;

export const getAiModelSelection = (
  settings: AiSettings
): AiModelSelection | null => {
  const { activeProvider } = settings;
  if (activeProvider === null) {
    return null;
  }
  const model = settings.providerModels[activeProvider];
  return model === null ? null : { model, provider: activeProvider };
};

export const getAvailableAiModelSelection = (
  selection: AiModelSelection,
  providers: readonly AiProviderStatus[]
): AiModelSelection | null => {
  const status = providers.find(
    (provider) => provider.provider === selection.provider
  );
  return status?.installed === true &&
    status.models.some(
      (availableModel) => availableModel.id === selection.model
    )
    ? selection
    : null;
};
