import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getHotkeyAriaLabel,
  getHotkeyDisplay,
  HotkeyHint,
  useAppCommand,
} from "@/hotkeys";

type TitlebarWorkspaceCommand = "app.openSettings" | "app.openTemplates";

interface TitlebarWorkspaceButtonProps {
  readonly children: ReactNode;
  readonly command: TitlebarWorkspaceCommand;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
}

const TitlebarWorkspaceButton = ({
  children,
  command,
  isOpen,
  onToggle,
}: TitlebarWorkspaceButtonProps) => {
  const display = getHotkeyDisplay(command);

  useAppCommand(command, onToggle);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-keyshortcuts={getHotkeyAriaLabel(command)}
            aria-label={display.label}
            aria-pressed={isOpen}
            onClick={onToggle}
            size="icon"
            type="button"
            variant={isOpen ? "secondary" : "ghost"}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent className="flex items-center gap-2" side="bottom">
        {display.label}
        <HotkeyHint command={command} />
      </TooltipContent>
    </Tooltip>
  );
};

export default TitlebarWorkspaceButton;
