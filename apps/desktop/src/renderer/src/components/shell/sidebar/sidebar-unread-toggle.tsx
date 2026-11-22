import { ListFilterIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
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
          <Button
            aria-keyshortcuts={getHotkeyAriaLabel("app.toggleUnread")}
            aria-label={display.label}
            aria-pressed={pressed}
            className={
              pressed
                ? undefined
                : "text-muted-foreground hover:text-foreground"
            }
            onClick={() => {
              onPressedChange(!pressed);
            }}
            size="icon-lg"
            type="button"
            variant={pressed ? "default" : "ghost"}
          >
            <ListFilterIcon className="stroke-[1.8]" />
          </Button>
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
