import { useLocation, useNavigate } from "@tanstack/react-router";
import { MailIcon } from "lucide-react";

import { Toggle } from "@/components/ui/toggle";
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
import { useMailboxStore, useShowUnread } from "@/state/mailbox";

const TitlebarUnreadToggle = () => {
  const showUnread = useShowUnread();
  const setShowUnread = useMailboxStore((state) => state.setShowUnread);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const display = getHotkeyDisplay("app.toggleUnread");

  const updateShowUnread = (pressed: boolean): void => {
    setShowUnread(pressed);

    if (pathname !== "/") {
      void navigate({ to: "/" });
    }
  };

  useAppCommand("app.toggleUnread", () => {
    updateShowUnread(!showUnread);
  });

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            aria-keyshortcuts={getHotkeyAriaLabel("app.toggleUnread")}
            aria-label={display.label}
            onPressedChange={updateShowUnread}
            pressed={showUnread}
            size="icon"
          >
            <MailIcon />
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

export default TitlebarUnreadToggle;
