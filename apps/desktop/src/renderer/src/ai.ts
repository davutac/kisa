import type {
  AiModelSelection,
  AiProvider,
  AiProviderStatus,
  AiReasoningOption,
  AiSettings,
} from "@/shared/ipc/ai";

export const AI_PROVIDER_NAMES = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
} satisfies Record<AiProvider, string>;

const AI_REASONING_NAMES = {
  high: "High",
  low: "Low",
  max: "Max",
  medium: "Medium",
  minimal: "Minimal",
  none: "None",
  xhigh: "Extra High",
} satisfies Readonly<Record<string, string>>;

export const getAiReasoningName = (reasoning: string): string =>
  AI_REASONING_NAMES[reasoning] ??
  reasoning
    .split(/[-_]/gu)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");

export const resolveAiReasoning = (
  reasoning: string | null | undefined,
  options: readonly AiReasoningOption[]
): string | null =>
  options.find(({ id }) => id === reasoning)?.id ??
  options.find(({ isDefault }) => isDefault === true)?.id ??
  null;

export const getAiModelSelection = (
  settings: AiSettings
): AiModelSelection | null => {
  const { activeProvider } = settings;
  if (activeProvider === null) {
    return null;
  }
  const model = settings.providerModels[activeProvider];
  const reasoning = settings.providerReasoning[activeProvider];
  if (model === null) {
    return null;
  }
  return { model, provider: activeProvider, reasoning: reasoning ?? undefined };
};

export const getAvailableAiModelSelection = (
  selection: AiModelSelection,
  providers: readonly AiProviderStatus[]
): AiModelSelection | null => {
  const status = providers.find(
    (provider) => provider.provider === selection.provider
  );
  const model = status?.models.find(
    (availableModel) => availableModel.id === selection.model
  );
  if (status?.installed !== true || model === undefined) {
    return null;
  }
  const reasoning = resolveAiReasoning(
    selection.reasoning,
    model.reasoningOptions
  );
  if (reasoning === selection.reasoning) {
    return selection;
  }
  if (reasoning !== null) {
    return { ...selection, reasoning };
  }
  return { model: selection.model, provider: selection.provider };
};
