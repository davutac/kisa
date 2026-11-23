import type { ReactNode } from "react";

import { Toggle } from "@/components/ui/toggle";
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
          <Toggle
            aria-keyshortcuts={getHotkeyAriaLabel(command)}
            aria-label={display.label}
            className="not-data-pressed:text-muted-foreground not-data-pressed:hover:text-foreground"
            onPressedChange={onToggle}
            pressed={isOpen}
            size="icon-lg"
          >
            {children}
          </Toggle>
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
