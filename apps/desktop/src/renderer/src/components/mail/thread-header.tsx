import {
  ArrowLeftIcon,
  InboxIcon,
  MailIcon,
  MailOpenIcon,
  SquareArrowOutUpRightIcon,
  Trash2Icon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import MailDate from "@/components/mail/mail-date";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AppCommand,
  getHotkeyAriaLabel,
  getHotkeyDisplay,
  HotkeyHint,
  useAppCommand,
} from "@/hotkeys";
import type { HotkeyCommandId } from "@/hotkeys";
import { quietDestructiveClassName } from "@/lib/action-hierarchy";
import { cn } from "@/lib/utils";

interface MailThreadHeaderActionProps {
  children: ReactNode;
  className?: string;
  command?: HotkeyCommandId;
  label: string;
  onClick: () => void;
  variant?: ComponentProps<typeof Button>["variant"];
}

const MailThreadHeaderAction = ({
  children,
  className,
  command,
  label,
  onClick,
  variant = "ghost",
}: MailThreadHeaderActionProps) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <Button
          aria-keyshortcuts={
            command === undefined ? undefined : getHotkeyAriaLabel(command)
          }
          aria-label={label}
          className={className}
          onClick={onClick}
          size="icon"
          type="button"
          variant={variant}
        >
          {children}
        </Button>
      }
    />
    <TooltipContent className="flex items-center gap-2" side="bottom">
      {label}
      {command === undefined ? null : <HotkeyHint command={command} />}
    </TooltipContent>
  </Tooltip>
);

interface MailThreadHeaderProps {
  isSpam: boolean;
  isUnread: boolean;
  latestAt?: number;
  onClose: () => void;
  onDeleteForever?: () => void;
  onNotSpam: () => void;
  onPopOut?: () => void;
  onToggleRead: () => void;
  onTrash?: () => void;
  showCloseButton?: boolean;
  subject: string;
}

const MailThreadHeader = ({
  isSpam,
  isUnread,
  latestAt,
  onClose,
  onDeleteForever,
  onNotSpam,
  onPopOut,
  onToggleRead,
  onTrash,
  showCloseButton = true,
  subject,
}: MailThreadHeaderProps) => {
  const toggleReadLabel = isUnread ? "Mark as read" : "Mark as unread";
  const closeDisplay = getHotkeyDisplay("thread.close");
  const popOutDisplay = getHotkeyDisplay("thread.popout");
  const trashDisplay = getHotkeyDisplay("thread.trashThread");
  const isDeleteForever = onDeleteForever !== undefined;
  const destructiveLabel = isDeleteForever
    ? "Delete forever"
    : trashDisplay.label;
  const destructiveAction = onDeleteForever ?? onTrash;

  useAppCommand("thread.close", onClose);
  useAppCommand("thread.toggleThreadRead", onToggleRead);
  useAppCommand("thread.trashThread", () => destructiveAction?.(), {
    enabled: destructiveAction !== undefined,
  });

  return (
    // Sticking at top-0 with an opaque pt-4 gutter reads as a top-4 offset
    // while keeping messages from showing through the gutter, the card's
    // rounded corners and the 1px flex gap as they scroll up behind it.
    <header
      className={cn(
        "bg-background after:bg-background sticky top-0 z-10 pt-4 after:absolute after:inset-x-0 after:top-full after:h-px",
        !onPopOut && "pt-0"
      )}
    >
      {onPopOut === undefined ? null : (
        <AppCommand callback={onPopOut} command="thread.popout" />
      )}
      <div className="bg-card flex min-w-0 items-center gap-2 rounded-t-lg p-4">
        {showCloseButton ? (
          <MailThreadHeaderAction
            className="shrink-0"
            command="thread.close"
            label={closeDisplay.label}
            onClick={onClose}
            variant="secondary"
          >
            <ArrowLeftIcon />
          </MailThreadHeaderAction>
        ) : null}
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold select-text">
          {subject}
        </h1>
        {latestAt === undefined ? null : (
          // Compact, so the subject keeps the room in a narrow pop-out window;
          // each message header carries the detailed time.
          <MailDate
            className="text-muted-foreground mr-1 text-sm"
            timestamp={latestAt}
            tooltipSide="bottom"
          />
        )}
        <div className="flex shrink-0 items-center gap-1">
          {isSpam ? (
            <MailThreadHeaderAction label="Not spam" onClick={onNotSpam}>
              <InboxIcon />
            </MailThreadHeaderAction>
          ) : null}
          <MailThreadHeaderAction
            command="thread.toggleThreadRead"
            label={toggleReadLabel}
            onClick={onToggleRead}
          >
            {isUnread ? <MailOpenIcon /> : <MailIcon />}
          </MailThreadHeaderAction>
          {destructiveAction === undefined ? null : (
            <MailThreadHeaderAction
              className={quietDestructiveClassName}
              command="thread.trashThread"
              label={destructiveLabel}
              onClick={destructiveAction}
            >
              <Trash2Icon />
            </MailThreadHeaderAction>
          )}
          {onPopOut === undefined ? null : (
            <>
              {/* A window action, kept apart from the mail actions so a
                  slip cannot trash the conversation. */}
              <span aria-hidden="true" className="bg-border mx-1 h-4 w-px" />
              <MailThreadHeaderAction
                command="thread.popout"
                label={popOutDisplay.label}
                onClick={onPopOut}
              >
                <SquareArrowOutUpRightIcon />
              </MailThreadHeaderAction>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

export default MailThreadHeader;
