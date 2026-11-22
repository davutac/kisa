import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getHotkeyAriaLabel, getHotkeyDisplay, HotkeyHint } from "@/hotkeys";

type SidebarWorkspaceCommand = "app.openSettings" | "app.openTemplates";

/**
 * An icon-only workspace toggle in the sidebar footer. Its shortcut is
 * registered by the shell, so it works while the sidebar is hidden.
 */
const SidebarWorkspaceButton = ({
  children,
  command,
  isOpen,
  onToggle,
}: {
  readonly children: ReactNode;
  readonly command: SidebarWorkspaceCommand;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
}) => {
  const display = getHotkeyDisplay(command);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-keyshortcuts={getHotkeyAriaLabel(command)}
            aria-label={display.label}
            aria-pressed={isOpen}
            className={
              isOpen ? undefined : "text-muted-foreground hover:text-foreground"
            }
            onClick={onToggle}
            size="icon-lg"
            type="button"
            variant={isOpen ? "secondary" : "ghost"}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent className="flex items-center gap-2" side="top">
        {display.label}
        <HotkeyHint command={command} />
      </TooltipContent>
    </Tooltip>
  );
};

export default SidebarWorkspaceButton;
