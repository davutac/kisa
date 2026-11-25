import { ListFilterIcon } from "lucide-react";

import { Toggle } from "@/components/ui/toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getHotkeyAriaLabel, getHotkeyDisplay, HotkeyHint } from "@/hotkeys";

/**
 * The unread-only filter beside sidebar search. It also narrows search
 * results, so it stays in the row while a search is open. Pressed, it fills,
 * so a filtered mailbox never passes for an empty one.
 */
const SidebarUnreadToggle = ({
  onPressedChange,
  pressed,
}: {
  readonly onPressedChange: (pressed: boolean) => void;
  readonly pressed: boolean;
}) => {
  const display = getHotkeyDisplay("app.toggleUnread");

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            aria-keyshortcuts={getHotkeyAriaLabel("app.toggleUnread")}
            aria-label={display.label}
            className="not-data-pressed:text-muted-foreground not-data-pressed:hover:text-foreground"
            onPressedChange={onPressedChange}
            pressed={pressed}
            pressedVariant="default"
            size="icon-lg"
          >
            <ListFilterIcon className="stroke-[1.8]" />
          </Toggle>
        }
      />
      <TooltipContent className="flex items-center gap-2" side="bottom">
        {display.label}
        <HotkeyHint command="app.toggleUnread" />
      </TooltipContent>
    </Tooltip>
  );
};

export default SidebarUnreadToggle;
