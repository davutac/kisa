import { LoaderCircleIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getHotkeyAriaLabel, getHotkeyDisplay, HotkeyHint } from "@/hotkeys";
import type { HotkeyCommandId } from "@/hotkeys";

interface AiComposerButtonProps {
  readonly command: HotkeyCommandId;
  readonly disabled: boolean;
  readonly grouped?: boolean;
  readonly icon: LucideIcon;
  readonly isWorking: boolean;
  readonly label: string;
  readonly modelLabel: string;
  readonly onClick: () => void;
  readonly workingLabel: string;
}

const AiComposerButton = ({
  command,
  disabled,
  grouped = false,
  icon: Icon,
  isWorking,
  label,
  modelLabel,
  onClick,
  workingLabel,
}: AiComposerButtonProps) => {
  const display = getHotkeyDisplay(command);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-busy={isWorking}
            aria-keyshortcuts={getHotkeyAriaLabel(command)}
            aria-label={display.label}
            disabled={disabled}
            onClick={onClick}
            type="button"
            variant={grouped ? "ghost" : "ai"}
          >
            {isWorking ? (
              <LoaderCircleIcon
                className="animate-spin"
                data-icon="inline-start"
              />
            ) : (
              <Icon data-icon="inline-start" />
            )}
            {isWorking ? workingLabel : label}
          </Button>
        }
      />
      <TooltipContent className="flex-col items-start gap-1" side="top">
        <span className="flex items-center gap-2">
          {display.label}
          <HotkeyHint command={command} />
        </span>
        <span className="text-background/70 break-all">{modelLabel}</span>
      </TooltipContent>
    </Tooltip>
  );
};

export default AiComposerButton;
