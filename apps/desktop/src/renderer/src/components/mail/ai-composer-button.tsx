import { LoaderCircleIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode, RefObject } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  readonly onClick?: () => void;
  readonly popover?: {
    readonly content: ReactNode;
    readonly handleOpenChange: (open: boolean) => void;
    readonly initialFocus: RefObject<HTMLElement | null>;
    readonly open: boolean;
  };
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
  popover,
  workingLabel,
}: AiComposerButtonProps) => {
  const display = getHotkeyDisplay(command);
  const button = (
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
        <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
      ) : (
        <Icon data-icon="inline-start" />
      )}
      {isWorking ? workingLabel : label}
    </Button>
  );
  const trigger =
    popover === undefined ? button : <PopoverTrigger render={button} />;
  const tooltip = (
    <Tooltip disabled={popover?.open}>
      <TooltipTrigger render={trigger} />
      <TooltipContent className="flex-col items-start gap-1" side="top">
        <span className="flex items-center gap-2">
          {display.label}
          <HotkeyHint command={command} />
        </span>
        <span className="text-background/70 break-all">{modelLabel}</span>
      </TooltipContent>
    </Tooltip>
  );

  if (popover === undefined) {
    return tooltip;
  }

  return (
    <Popover
      onOpenChange={popover.handleOpenChange}
      open={popover.open && !disabled}
    >
      {tooltip}
      <PopoverContent
        align="start"
        className="max-h-[calc(100dvh-2rem)] w-80 gap-2 overflow-y-auto"
        initialFocus={popover.initialFocus}
        side="top"
      >
        {popover.content}
      </PopoverContent>
    </Popover>
  );
};

export default AiComposerButton;
