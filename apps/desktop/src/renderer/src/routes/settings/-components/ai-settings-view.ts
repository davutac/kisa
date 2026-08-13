import type {
  AiProvider,
  AiProviderModels,
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

const getOpenCodeProviderLabel = (model: string): string => {
  const separator = model.indexOf("/");
  if (separator <= 0) {
    return "Other";
  }
  const provider = model.slice(0, separator);
  const knownLabel = OPENCODE_PROVIDER_LABELS[provider.toLowerCase()];
  if (knownLabel !== undefined) {
    return knownLabel;
  }
  return provider
    .split(/[-_]/gu)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
};

export const groupOpenCodeModelOptions = (
  options: readonly AiProviderModelOption[]
): readonly AiProviderModelGroup[] => {
  const groups = new Map<string, AiProviderModelOption[]>();
  for (const option of options) {
    const label = getOpenCodeProviderLabel(option.model);
    const group = groups.get(label);
    if (group === undefined) {
      groups.set(label, [option]);
    } else {
      group.push(option);
    }
  }
  return [...groups.entries()].map(([label, groupOptions]) => ({
    items: groupOptions,
    label,
  }));
};

export const areAiProviderModelsEqual = (
  left: AiProviderModels,
  right: AiProviderModels
): boolean =>
  left.claude === right.claude &&
  left.codex === right.codex &&
  left.opencode === right.opencode;

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
