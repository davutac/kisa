import type { ComponentType, SVGProps } from "react";

import { AI_PROVIDER_NAMES } from "@/ai";
import { RadioGroupItem } from "@/components/ui/radio-group";
import {
  SettingsRow,
  SettingsRowActions,
  SettingsRowContent,
} from "@/components/ui/settings";
import { cn } from "@/lib/utils";
import type { AiProvider, AiProviderStatus } from "@/shared/ipc/ai";

import {
  ClaudeProviderIcon,
  CodexProviderIcon,
  OpenCodeProviderIcon,
} from "./ai-provider-icons";
import { AiModelSelect, AiReasoningSelect } from "./ai-provider-selectors";
import {
  getAiProviderModelOptions,
  getAiProviderPresentation,
} from "./ai-settings-view";
import type { AiProviderPresentation } from "./ai-settings-view";

const PROVIDER_ICONS = {
  claude: ClaudeProviderIcon,
  codex: CodexProviderIcon,
  opencode: OpenCodeProviderIcon,
} satisfies Record<AiProvider, ComponentType<SVGProps<SVGSVGElement>>>;

interface AiProviderRowProps {
  readonly activeProvider: AiProvider | null;
  readonly currentModel: string | null;
  readonly currentReasoning: string | null;
  readonly isLoading: boolean;
  readonly onSelectModel: (model: string) => void;
  readonly onSelectReasoning: (reasoning: string) => void;
  readonly provider: AiProvider;
  readonly status: AiProviderStatus | undefined;
}

const getModelOptions = (
  status: AiProviderStatus | undefined,
  currentModel: string | null
) => {
  if (status !== undefined) {
    return getAiProviderModelOptions(status);
  }
  return currentModel === null
    ? []
    : [{ label: currentModel, model: currentModel }];
};

const getModelGenerationOptions = (
  status: AiProviderStatus | undefined,
  currentModel: string | null
) => {
  const selectedModel = status?.models.find(({ id }) => id === currentModel);
  return {
    optionLabel: selectedModel?.optionLabel ?? "Reasoning",
    reasoningOptions: selectedModel?.reasoningOptions ?? [],
  };
};

const AiProviderStatusText = ({
  id,
  presentation,
}: {
  readonly id: string;
  readonly presentation: AiProviderPresentation | null;
}) => {
  if (presentation?.showHeadline === false && presentation.detail === null) {
    return null;
  }
  if (presentation?.showHeadline === false) {
    return (
      <p
        className="text-muted-foreground/80 text-[13px] leading-[1.45]"
        id={id}
      >
        {presentation.detail}
      </p>
    );
  }
  return (
    <p
      className="text-muted-foreground/80 flex min-w-0 flex-wrap items-center gap-x-1 text-[13px] leading-[1.45]"
      id={id}
    >
      <span>{presentation?.headline ?? "Checking provider status"}</span>
      {presentation?.detail ? (
        <>
          <span aria-hidden>·</span>
          <span>{presentation.detail}</span>
        </>
      ) : null}
    </p>
  );
};

const AiProviderRow = ({
  activeProvider,
  currentModel,
  currentReasoning,
  isLoading,
  onSelectModel,
  onSelectReasoning,
  provider,
  status,
}: AiProviderRowProps) => {
  const Icon = PROVIDER_ICONS[provider];
  const isSelected = activeProvider === provider;
  const presentation =
    status === undefined ? null : getAiProviderPresentation(status);
  const modelOptions = getModelOptions(status, currentModel);
  const hasSelectableModel =
    status?.installed === true && status.models.length > 0;
  const { optionLabel, reasoningOptions } = getModelGenerationOptions(
    status,
    currentModel
  );
  const canActivateProvider = modelOptions.some(
    (option) => option.model === currentModel
  );
  const statusId = `ai-provider-${provider}-status`;
  const showStatusText =
    presentation?.showHeadline !== false || presentation.detail !== null;

  return (
    <SettingsRow
      className={cn(isSelected && "bg-muted/25")}
      data-provider={provider}
    >
      <SettingsRowContent className="flex-row items-start gap-3">
        <RadioGroupItem
          aria-describedby={showStatusText ? statusId : undefined}
          aria-label={`Use ${AI_PROVIDER_NAMES[provider]} for generation`}
          className="mt-0.5"
          disabled={!canActivateProvider}
          value={provider}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="relative inline-flex size-5 shrink-0 items-center justify-center">
              <Icon aria-hidden className="text-foreground/80 size-4" />
              <span
                aria-hidden
                className={cn(
                  "ring-card absolute -top-0.5 -left-0.5 size-2 rounded-full ring-2",
                  presentation?.dotClassName ?? "bg-muted-foreground/40",
                  isLoading && "animate-pulse"
                )}
              />
            </span>
            <span className="text-foreground truncate text-sm font-medium tracking-[-0.005em]">
              {AI_PROVIDER_NAMES[provider]}
            </span>
            {status?.version ? (
              <code className="text-muted-foreground shrink-0 text-xs">
                v{status.version}
              </code>
            ) : null}
          </div>
          <AiProviderStatusText id={statusId} presentation={presentation} />
        </div>
      </SettingsRowContent>

      <SettingsRowActions className="w-full flex-wrap justify-end sm:w-auto">
        <AiModelSelect
          currentModel={currentModel}
          disabled={!hasSelectableModel}
          modelOptions={modelOptions}
          onSelectModel={onSelectModel}
          provider={provider}
          statusDescriptionId={showStatusText ? statusId : undefined}
        />
        {hasSelectableModel && reasoningOptions.length > 0 ? (
          <AiReasoningSelect
            currentReasoning={currentReasoning}
            onSelectReasoning={onSelectReasoning}
            optionLabel={optionLabel}
            provider={provider}
            reasoningOptions={reasoningOptions}
          />
        ) : null}
      </SettingsRowActions>
    </SettingsRow>
  );
};

export default AiProviderRow;
