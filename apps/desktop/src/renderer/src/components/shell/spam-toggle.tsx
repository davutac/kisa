import { useLocation, useNavigate } from "@tanstack/react-router";
import { ShieldAlertIcon } from "lucide-react";

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
import { useMailboxAccountScope } from "@/mail/use-mailbox-account-scope";
import { useHasUnreadSpam } from "@/mail/use-spam-status";
import { useMailbox, useMailboxStore } from "@/state/mailbox";

const TitlebarSpamToggle = () => {
  const { accountIds } = useMailboxAccountScope();
  const mailbox = useMailbox();
  const setMailbox = useMailboxStore((state) => state.setMailbox);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const hasUnreadSpam = useHasUnreadSpam(accountIds);
  const display = getHotkeyDisplay("app.toggleSpam");

  const updateMailbox = (pressed: boolean): void => {
    setMailbox(pressed ? "spam" : "inbox");

    if (pathname !== "/") {
      void navigate({ to: "/" });
    }
  };

  useAppCommand("app.toggleSpam", () => {
    updateMailbox(mailbox !== "spam");
  });

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            aria-keyshortcuts={getHotkeyAriaLabel("app.toggleSpam")}
            aria-label={hasUnreadSpam ? "Spam, unread messages" : "Spam"}
            className="relative"
            onPressedChange={updateMailbox}
            pressed={mailbox === "spam"}
            size="icon"
          >
            <ShieldAlertIcon />
            {hasUnreadSpam ? (
              <span
                aria-hidden="true"
                className="bg-destructive absolute top-1.5 right-1.5 size-1.5 rounded-full"
              />
            ) : null}
          </Toggle>
        }
      />
      <TooltipContent className="flex items-center gap-2" side="bottom">
        {display.label}
        <HotkeyHint command="app.toggleSpam" />
      </TooltipContent>
    </Tooltip>
  );
};

export default TitlebarSpamToggle;
