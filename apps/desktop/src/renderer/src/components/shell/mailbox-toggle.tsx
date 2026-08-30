import { useLocation, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

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
import type { HotkeyCommandId } from "@/hotkeys";
import type { GmailMailbox } from "@/shared/ipc/mail";
import { useMailbox, useMailboxStore } from "@/state/mailbox";

interface TitlebarMailboxToggleProps {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  command: Extract<
    HotkeyCommandId,
    "app.toggleSent" | "app.toggleSpam" | "app.toggleTrash"
  >;
  mailbox: Exclude<GmailMailbox, "inbox">;
}

const TitlebarMailboxToggle = ({
  ariaLabel,
  children,
  className,
  command,
  mailbox: targetMailbox,
}: TitlebarMailboxToggleProps) => {
  const mailbox = useMailbox();
  const setMailbox = useMailboxStore((state) => state.setMailbox);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const display = getHotkeyDisplay(command);

  const updateMailbox = (pressed: boolean): void => {
    setMailbox(pressed ? targetMailbox : "inbox");

    if (pathname !== "/") {
      void navigate({ to: "/" });
    }
  };

  useAppCommand(command, () => {
    updateMailbox(mailbox !== targetMailbox);
  });

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            aria-keyshortcuts={getHotkeyAriaLabel(command)}
            aria-label={ariaLabel}
            className={className}
            onPressedChange={updateMailbox}
            pressed={mailbox === targetMailbox}
            size="icon"
          >
            {children}
          </Toggle>
        }
      />
      <TooltipContent className="flex items-center gap-2" side="bottom">
        {display.label}
        <HotkeyHint command={command} />
      </TooltipContent>
    </Tooltip>
  );
};

export default TitlebarMailboxToggle;
