import { ChevronDownIcon } from "lucide-react";
import { Fragment } from "react";
import type { ComponentType, SVGProps } from "react";

import { AI_PROVIDER_NAMES } from "@/ai";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  getAiProviderModelOptions,
  getAiProviderPresentation,
  groupOpenCodeModelOptions,
} from "./ai-settings-view";
import type {
  AiProviderModelGroup,
  AiProviderModelOption,
  AiProviderPresentation,
} from "./ai-settings-view";

const DROPDOWN_MENU_COLLISION_AVOIDANCE = { side: "none" } as const;

const PROVIDER_ICONS = {
  claude: ClaudeProviderIcon,
  codex: CodexProviderIcon,
  opencode: OpenCodeProviderIcon,
} satisfies Record<AiProvider, ComponentType<SVGProps<SVGSVGElement>>>;

interface AiProviderRowProps {
  readonly activeProvider: AiProvider | null;
  readonly currentModel: string | null;
  readonly isLoading: boolean;
  readonly onSelectModel: (model: string) => void;
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

interface AiModelMenuItemsProps {
  readonly currentModel: string | null;
  readonly modelGroups: readonly AiProviderModelGroup[] | null;
  readonly modelOptions: readonly AiProviderModelOption[];
  readonly onSelectModel: (model: string) => void;
}

interface AiModelDropdownProps extends AiModelMenuItemsProps {
  readonly hasSelectableModel: boolean;
  readonly provider: AiProvider;
  readonly showStatusText: boolean;
  readonly statusId: string;
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

  return modelGroups.map((group, groupIndex) => (
    <Fragment key={group.label}>
      {groupIndex === 0 ? null : <DropdownMenuSeparator />}
      <DropdownMenuGroup>
        <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          onValueChange={onSelectModel}
          value={currentModel ?? ""}
        >
          {group.items.map((option) => (
            <DropdownMenuRadioItem key={option.model} value={option.model}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
    </Fragment>
  ));
};

const AiModelDropdown = ({
  currentModel,
  hasSelectableModel,
  modelGroups,
  modelOptions,
  onSelectModel,
  provider,
  showStatusText,
  statusId,
}: AiModelDropdownProps) => {
  const selectedModel =
    modelOptions.find((option) => option.model === currentModel) ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={!hasSelectableModel}
        render={
          <Button
            aria-describedby={showStatusText ? statusId : undefined}
            aria-label={`${AI_PROVIDER_NAMES[provider]} model, ${selectedModel?.label ?? "none selected"}`}
            className="w-full justify-between font-normal sm:w-48"
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
        collisionAvoidance={DROPDOWN_MENU_COLLISION_AVOIDANCE}
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
  isLoading,
  onSelectModel,
  provider,
  status,
}: AiProviderRowProps) => {
  const Icon = PROVIDER_ICONS[provider];
  const isSelected = activeProvider === provider;
  const presentation =
    status === undefined ? null : getAiProviderPresentation(status);
  const modelOptions = getModelOptions(status, currentModel);
  const modelGroups =
    provider === "opencode" ? groupOpenCodeModelOptions(modelOptions) : null;
  const hasSelectableModel =
    status?.installed === true && status.models.length > 0;
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

      <SettingsRowActions className="w-full sm:w-auto">
        <AiModelDropdown
          currentModel={currentModel}
          hasSelectableModel={hasSelectableModel}
          modelGroups={modelGroups}
          modelOptions={modelOptions}
          onSelectModel={onSelectModel}
          provider={provider}
          showStatusText={showStatusText}
          statusId={statusId}
        />
      </SettingsRowActions>
    </SettingsRow>
  );
};

export default AiProviderRow;
