import {
  AI_PROVIDER_NAMES,
  getAiModelSelection,
  getAvailableAiModelSelection,
} from "@/ai";
import { useAiProviderState } from "@/state/ai-provider-state";

export const useAiModelSelection = () => {
  const isLoadingProviders = useAiProviderState(
    (state) => state.isLoadingProviders
  );
  const isLoadingSettings = useAiProviderState(
    (state) => state.isLoadingSettings
  );
  const providers = useAiProviderState((state) => state.providers);
  const settings = useAiProviderState((state) => state.settings);
  const configuredSelection =
    settings === null ? null : getAiModelSelection(settings);
  const selection =
    configuredSelection === null
      ? null
      : getAvailableAiModelSelection(configuredSelection, providers);
  const isLoading =
    settings === null
      ? isLoadingSettings
      : configuredSelection !== null &&
        providers.length === 0 &&
        isLoadingProviders;

  let label = "Choose an AI provider in Settings";
  if (isLoading) {
    label = "Loading AI provider…";
  } else if (selection !== null) {
    label = `${AI_PROVIDER_NAMES[selection.provider]} · ${selection.model}`;
  }

  return { label, selection };
};
