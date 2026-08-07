import { useLocation, useNavigate } from "@tanstack/react-router";
import { MailIcon } from "lucide-react";

import { Toggle } from "@/components/ui/toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useMailboxStore, useShowUnread } from "@/state/mailbox";

const TitlebarUnreadToggle = () => {
  const showUnread = useShowUnread();
  const setShowUnread = useMailboxStore((state) => state.setShowUnread);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const updateShowUnread = (pressed: boolean): void => {
    setShowUnread(pressed);

    if (pathname !== "/") {
      void navigate({ to: "/" });
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            aria-label="Show unread email only"
            onPressedChange={updateShowUnread}
            pressed={showUnread}
          >
            <MailIcon data-icon="inline-start" />
            Unread
          </Toggle>
        }
      />
      <TooltipContent side="bottom">Show unread email only</TooltipContent>
    </Tooltip>
  );
};

export default TitlebarUnreadToggle;
