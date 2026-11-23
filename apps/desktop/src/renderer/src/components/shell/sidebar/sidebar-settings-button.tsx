import { SettingsIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DialogTrigger } from "@/components/ui/dialog";
import type { DialogController } from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getHotkeyAriaLabel, getHotkeyDisplay, HotkeyHint } from "@/hotkeys";

/**
 * Opens the Settings dialog from the sidebar footer. The shell owns the
 * dialog and its shortcut, so both work while the sidebar is hidden.
 */
const SidebarSettingsButton = ({
  controller,
}: {
  readonly controller: DialogController;
}) => {
  const display = getHotkeyDisplay("app.openSettings");

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <DialogTrigger
            controller={controller}
            render={
              <Button
                aria-keyshortcuts={getHotkeyAriaLabel("app.openSettings")}
                aria-label={display.label}
                className="text-muted-foreground hover:text-foreground"
                size="icon-lg"
                type="button"
                variant="ghost"
              >
                <SettingsIcon className="stroke-[1.8]" />
              </Button>
            }
          />
        }
      />
      {/* A tooltip around a dialog trigger shares its name, so an agent's
          step by that name would match both. */}
      <TooltipContent
        className="flex items-center gap-2"
        data-agent-hidden
        side="top"
      >
        {display.label}
        <HotkeyHint command="app.openSettings" />
      </TooltipContent>
    </Tooltip>
  );
};

export default SidebarSettingsButton;
