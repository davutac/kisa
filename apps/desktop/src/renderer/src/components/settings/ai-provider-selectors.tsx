import { ChevronDownIcon } from "lucide-react";

import {
  AI_PROVIDER_NAMES,
  getAiReasoningOptionName,
  resolveAiReasoning,
} from "@/ai";
import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from "@/components/ui/menu";
import type { AiProvider, AiReasoningOption } from "@/shared/ipc/ai";

import type {
  AiProviderModelGroup,
  AiProviderModelOption,
} from "./ai-settings-view";
import { groupOpenCodeModelOptions } from "./ai-settings-view";

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
      <MenuRadioGroup onValueChange={onSelectModel} value={currentModel ?? ""}>
        {modelOptions.map((option) => (
          <MenuRadioItem key={option.model} value={option.model}>
            {option.label}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    );
  }

  return modelGroups.map((group) => (
    <MenuSub key={group.id}>
      <MenuSubTrigger>{group.label}</MenuSubTrigger>
      <MenuSubContent className="min-w-52">
        <MenuRadioGroup
          onValueChange={onSelectModel}
          value={currentModel ?? ""}
        >
          {group.items.map((option) => (
            <MenuRadioItem
              className="whitespace-nowrap"
              closeOnSelect
              key={option.model}
              value={option.model}
            >
              {option.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuSubContent>
    </MenuSub>
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
    <Menu>
      <MenuTrigger
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
      </MenuTrigger>
      <MenuContent align="end" side="bottom">
        <AiModelMenuItems
          currentModel={currentModel}
          modelGroups={modelGroups}
          modelOptions={modelOptions}
          onSelectModel={onSelectModel}
        />
      </MenuContent>
    </Menu>
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
    <Menu>
      <MenuTrigger
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
      </MenuTrigger>
      <MenuContent className="w-fit" side="bottom">
        <MenuGroup>
          <MenuGroupLabel>{optionLabel}</MenuGroupLabel>
          <MenuRadioGroup
            onValueChange={onSelectReasoning}
            value={selectedId ?? ""}
          >
            {reasoningOptions.map((option) => (
              <MenuRadioItem
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
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
      </MenuContent>
    </Menu>
  );
};
