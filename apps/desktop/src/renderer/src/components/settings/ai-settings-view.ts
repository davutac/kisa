import { resolveAiReasoning } from "@/ai";
import type {
  AiModel,
  AiProvider,
  AiProviderModels,
  AiProviderReasoning,
  AiProviderStatus,
} from "@/shared/ipc/ai";

export const AI_PROVIDER_ORDER = [
  "codex",
  "claude",
  "opencode",
] as const satisfies readonly AiProvider[];

export interface AiProviderPresentation {
  readonly detail: string | null;
  readonly dotClassName: string;
  readonly headline: string;
  readonly showHeadline: boolean;
}

export interface AiProviderModelOption {
  readonly label: string;
  readonly model: string;
}

export interface AiProviderModelGroup {
  readonly id: string;
  readonly items: readonly AiProviderModelOption[];
  readonly label: string;
}

const OPENCODE_PROVIDER_LABELS = {
  anthropic: "Anthropic",
  azure: "Azure",
  github: "GitHub",
  "github-copilot": "GitHub Copilot",
  google: "Google",
  openai: "OpenAI",
  opencode: "OpenCode",
  openrouter: "OpenRouter",
} satisfies Readonly<Record<string, string>>;

const getOpenCodeProvider = (model: string) => {
  const separator = model.indexOf("/");
  if (separator <= 0) {
    return { id: "", label: "Other" };
  }
  const provider = model.slice(0, separator);
  const knownLabel = OPENCODE_PROVIDER_LABELS[provider.toLowerCase()];
  if (knownLabel !== undefined) {
    return { id: provider, label: knownLabel };
  }
  return {
    id: provider,
    label: provider
      .split(/[-_]/gu)
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(" "),
  };
};

export const groupOpenCodeModelOptions = (
  options: readonly AiProviderModelOption[]
): readonly AiProviderModelGroup[] => {
  const groups = new Map<
    string,
    { readonly items: AiProviderModelOption[]; readonly label: string }
  >();
  for (const option of options) {
    const provider = getOpenCodeProvider(option.model);
    const group = groups.get(provider.id);
    if (group === undefined) {
      groups.set(provider.id, { items: [option], label: provider.label });
    } else {
      group.items.push(option);
    }
  }
  return [...groups.entries()].map(([id, group]) => ({
    id,
    items: group.items,
    label: group.label,
  }));
};

const areProviderValuesEqual = (
  left: Record<AiProvider, string | null>,
  right: Record<AiProvider, string | null>
): boolean =>
  AI_PROVIDER_ORDER.every((provider) => left[provider] === right[provider]);

export const areAiProviderModelsEqual = (
  left: AiProviderModels,
  right: AiProviderModels
): boolean => areProviderValuesEqual(left, right);

export const areAiProviderReasoningEqual = (
  left: AiProviderReasoning,
  right: AiProviderReasoning
): boolean => areProviderValuesEqual(left, right);

export const getReasoningAfterModelChange = (
  currentReasoning: string | null,
  model?: AiModel
): string | null =>
  resolveAiReasoning(currentReasoning, model?.reasoningOptions ?? []);

export const getAiProviderPresentation = (
  provider: AiProviderStatus
): AiProviderPresentation => {
  if (!provider.installed) {
    return {
      detail: provider.error ?? "CLI not detected on PATH.",
      dotClassName: "bg-destructive",
      headline: "Not found",
      showHeadline: true,
    };
  }
  if (provider.authentication === "authenticated") {
    const detail = [provider.authLabel, provider.message]
      .filter((value): value is string => Boolean(value))
      .join(" · ");
    return {
      detail: provider.error ?? (detail || null),
      dotClassName: "bg-emerald-500",
      headline: provider.authEmail
        ? `Authenticated as ${provider.authEmail}`
        : "Authenticated",
      showHeadline: true,
    };
  }
  if (provider.authentication === "unauthenticated") {
    return {
      detail: provider.error ?? "Sign in with the provider CLI to use it.",
      dotClassName: "bg-amber-500",
      headline: "Not authenticated",
      showHeadline: true,
    };
  }
  if (provider.models.length > 0) {
    return {
      detail:
        provider.error ??
        provider.message ??
        "Installed and ready, but authentication could not be verified.",
      dotClassName: "bg-emerald-500",
      headline: "Available",
      showHeadline: false,
    };
  }
  return {
    detail:
      provider.error ??
      provider.message ??
      "The provider status could not be verified.",
    dotClassName: "bg-amber-500",
    headline: "Needs attention",
    showHeadline: true,
  };
};

export const getAiProviderModelOptions = (
  provider: AiProviderStatus
): readonly AiProviderModelOption[] =>
  provider.models.map((model) => ({
    label: model.name,
    model: model.id,
  }));
