import { ChevronDownIcon } from "lucide-react";

import {
  AI_PROVIDER_NAMES,
  getAiReasoningOptionName,
  resolveAiReasoning,
} from "@/ai";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AiProvider, AiReasoningOption } from "@/shared/ipc/ai";

import type {
  AiProviderModelGroup,
  AiProviderModelOption,
} from "./ai-settings-view";
import { groupOpenCodeModelOptions } from "./ai-settings-view";

const COLLISION_AVOIDANCE = { side: "none" } as const;

interface AiModelMenuItemsProps {
  readonly currentModel: string | null;
  readonly modelGroups: readonly AiProviderModelGroup[] | null;
  readonly modelOptions: readonly AiProviderModelOption[];
  readonly onSelectModel: (model: string) => void;
}

const AiModelMenuItems = ({
  currentModel,
  modelGroups,
  modelOptions,
  onSelectModel,
}: AiModelMenuItemsProps) => {
  if (modelGroups === null) {
    return (
      <DropdownMenuRadioGroup
        onValueChange={onSelectModel}
        value={currentModel ?? ""}
      >
        {modelOptions.map((option) => (
          <DropdownMenuRadioItem key={option.model} value={option.model}>
            {option.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    );
  }

  return modelGroups.map((group) => (
    <DropdownMenuSub key={group.id}>
      <DropdownMenuSubTrigger>{group.label}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-52">
        <DropdownMenuRadioGroup
          onValueChange={onSelectModel}
          value={currentModel ?? ""}
        >
          {group.items.map((option) => (
            <DropdownMenuRadioItem
              className="whitespace-nowrap"
              closeOnClick
              key={option.model}
              value={option.model}
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  ));
};

export const AiModelSelect = ({
  currentModel,
  disabled,
  modelOptions,
  onSelectModel,
  provider,
  statusDescriptionId,
}: {
  readonly currentModel: string | null;
  readonly disabled: boolean;
  readonly modelOptions: readonly AiProviderModelOption[];
  readonly onSelectModel: (model: string) => void;
  readonly provider: AiProvider;
  readonly statusDescriptionId?: string;
}) => {
  const selectedModel = modelOptions.find(
    (option) => option.model === currentModel
  );
  const modelGroups =
    provider === "opencode" ? groupOpenCodeModelOptions(modelOptions) : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <Button
            aria-describedby={statusDescriptionId}
            aria-label={`${AI_PROVIDER_NAMES[provider]} model, ${selectedModel?.label ?? "none selected"}`}
            className="w-fit max-w-full justify-between gap-3 font-normal"
            type="button"
            variant="secondary"
          />
        }
      >
        <span className="truncate">
          {selectedModel?.label ?? "Choose model"}
        </span>
        <ChevronDownIcon
          aria-hidden
          className="text-muted-foreground shrink-0"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        collisionAvoidance={COLLISION_AVOIDANCE}
        side="bottom"
      >
        <AiModelMenuItems
          currentModel={currentModel}
          modelGroups={modelGroups}
          modelOptions={modelOptions}
          onSelectModel={onSelectModel}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const AiReasoningSelect = ({
  currentReasoning,
  onSelectReasoning,
  optionLabel,
  provider,
  reasoningOptions,
}: {
  readonly currentReasoning: string | null;
  readonly onSelectReasoning: (reasoning: string) => void;
  readonly optionLabel: string;
  readonly provider: AiProvider;
  readonly reasoningOptions: readonly AiReasoningOption[];
}) => {
  const selectedId = resolveAiReasoning(currentReasoning, reasoningOptions);
  const selectedOption = reasoningOptions.find(({ id }) => id === selectedId);
  const selectedLabel = selectedOption
    ? getAiReasoningOptionName(selectedOption)
    : `Choose ${optionLabel.toLowerCase()}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={`${AI_PROVIDER_NAMES[provider]} ${optionLabel.toLowerCase()}, ${selectedLabel}`}
            className="w-fit max-w-full justify-between gap-3 font-normal"
            type="button"
            variant="secondary"
          />
        }
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDownIcon
          aria-hidden
          className="text-muted-foreground shrink-0"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-fit"
        collisionAvoidance={COLLISION_AVOIDANCE}
        side="bottom"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>{optionLabel}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            onValueChange={onSelectReasoning}
            value={selectedId ?? ""}
          >
            {reasoningOptions.map((option) => (
              <DropdownMenuRadioItem
                key={option.id}
                title={option.description}
                value={option.id}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">
                    {getAiReasoningOptionName(option)}
                  </span>
                  {option.isDefault ? (
                    <span className="text-muted-foreground text-xs">
                      Default
                    </span>
                  ) : null}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
