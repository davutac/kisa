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

interface MailThreadActionsProps {
  /** Sizes the date to its surroundings: the titlebar or the header card. */
  dateClassName?: string;
  isSpam: boolean;
  isUnread: boolean;
  latestAt?: number;
  onDeleteForever?: () => void;
  onNotSpam: () => void;
  onPopOut?: () => void;
  onToggleRead: () => void;
  onTrash?: () => void;
}

/**
 * The conversation's date and actions. The main window puts them in its
 * content titlebar; a pop-out window, which has no titlebar to fill, keeps
 * them in the header card. Their shortcuts are `MailThreadCommands`', so they
 * work wherever the buttons are shown.
 */
export const MailThreadActions = ({
  dateClassName,
  isSpam,
  isUnread,
  latestAt,
  onDeleteForever,
  onNotSpam,
  onPopOut,
  onToggleRead,
  onTrash,
}: MailThreadActionsProps) => {
  const toggleReadLabel = isUnread ? "Mark as read" : "Mark as unread";
  const popOutDisplay = getHotkeyDisplay("thread.popout");
  const trashDisplay = getHotkeyDisplay("thread.trashThread");
  const destructiveLabel =
    onDeleteForever === undefined ? trashDisplay.label : "Delete forever";
  const destructiveAction = onDeleteForever ?? onTrash;

  return (
    <>
      {latestAt === undefined ? null : (
        // Compact, so the subject keeps the room; each message header
        // carries the detailed time.
        <MailDate
          className={cn("text-muted-foreground mr-1", dateClassName)}
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
    </>
  );
};

interface MailThreadCommandsProps {
  onClose: () => void;
  onDeleteForever?: () => void;
  onPopOut?: () => void;
  onToggleRead: () => void;
  onTrash?: () => void;
}

/**
 * The open conversation's shortcuts, registered by the conversation itself
 * rather than by its buttons, so they hold however the buttons are placed.
 */
export const MailThreadCommands = ({
  onClose,
  onDeleteForever,
  onPopOut,
  onToggleRead,
  onTrash,
}: MailThreadCommandsProps) => {
  const destructiveAction = onDeleteForever ?? onTrash;

  useAppCommand("thread.close", onClose);
  useAppCommand("thread.toggleThreadRead", onToggleRead);
  useAppCommand("thread.trashThread", () => destructiveAction?.(), {
    enabled: destructiveAction !== undefined,
  });

  return onPopOut === undefined ? null : (
    <AppCommand callback={onPopOut} command="thread.popout" />
  );
};

interface MailThreadHeaderProps extends MailThreadActionsProps {
  onClose: () => void;
  showCloseButton?: boolean;
  subject: string;
}

/**
 * The header card a pop-out window shows above the conversation: its subject
 * and actions, sticking to the top as the messages scroll.
 */
const MailThreadHeader = ({
  onClose,
  showCloseButton = true,
  subject,
  ...actions
}: MailThreadHeaderProps) => {
  const closeDisplay = getHotkeyDisplay("thread.close");

  return (
    // Sticking at top-0 with an opaque gutter keeps messages from showing
    // through the card's rounded corners and the 1px flex gap as they scroll
    // up behind it.
    <header className="bg-background after:bg-background sticky top-0 z-10 after:absolute after:inset-x-0 after:top-full after:h-px">
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
        <MailThreadActions dateClassName="text-sm" {...actions} />
      </div>
    </header>
  );
};

export default MailThreadHeader;
