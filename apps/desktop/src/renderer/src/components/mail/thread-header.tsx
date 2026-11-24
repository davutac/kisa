import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  InboxIcon,
  MailIcon,
  MailOpenIcon,
  ShieldAlertIcon,
  SquareArrowOutUpRightIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import MailDate from "@/components/mail/mail-date";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
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
  confirm?: string;
  label: string;
  onClick: () => void;
  variant?: ComponentProps<typeof Button>["variant"];
}

const MailThreadHeaderAction = ({
  children,
  className,
  command,
  confirm,
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
          data-agent-confirm={confirm}
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
  isStarred: boolean;
  isUnread: boolean;
  latestAt?: number;
  /** In the Inbox; Move to Inbox takes its place once the conversation left. */
  onArchive?: () => void;
  onDeleteForever?: () => void;
  onMoveToInbox?: () => void;
  onNotSpam: () => void;
  onPopOut?: () => void;
  onReportSpam?: () => void;
  onToggleRead: () => void;
  /** Absent in Spam and Trash. */
  onToggleStar?: () => void;
  onTrash?: () => void;
  subject: string;
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
  isStarred,
  isUnread,
  latestAt,
  onArchive,
  onDeleteForever,
  onMoveToInbox,
  onNotSpam,
  onPopOut,
  onReportSpam,
  onToggleRead,
  onToggleStar,
  onTrash,
  subject,
}: MailThreadActionsProps) => {
  const toggleReadLabel = isUnread ? "Mark as read" : "Mark as unread";
  const popOutDisplay = getHotkeyDisplay("thread.popout");
  const trashDisplay = getHotkeyDisplay("thread.trashThread");
  const destructiveLabel =
    onDeleteForever === undefined ? trashDisplay.label : "Delete forever";
  const destructiveAction = onDeleteForever ?? onTrash;
  const trimmedSubject = subject.trim();
  const conversation =
    trimmedSubject === "" ? "this conversation" : `“${trimmedSubject}”`;
  // Delete forever asks through useConfirm, whose confirming button is marked.
  const trashConfirmation =
    onDeleteForever === undefined
      ? `Moves ${conversation} to Trash`
      : undefined;

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
        {onArchive === undefined ? null : (
          <MailThreadHeaderAction
            command="thread.archiveThread"
            label="Archive"
            onClick={onArchive}
          >
            <ArchiveIcon />
          </MailThreadHeaderAction>
        )}
        {onMoveToInbox === undefined ? null : (
          <MailThreadHeaderAction
            command="thread.archiveThread"
            label="Move to Inbox"
            onClick={onMoveToInbox}
          >
            <ArchiveRestoreIcon />
          </MailThreadHeaderAction>
        )}
        {onToggleStar === undefined ? null : (
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  aria-keyshortcuts={getHotkeyAriaLabel(
                    "thread.toggleThreadStar"
                  )}
                  aria-label="Star"
                  onPressedChange={onToggleStar}
                  pressed={isStarred}
                  pressedVariant="ghost"
                >
                  <StarIcon className="group-data-pressed/button:fill-current" />
                </Toggle>
              }
            />
            <TooltipContent className="flex items-center gap-2" side="bottom">
              {isStarred ? "Remove star" : "Star"}
              <HotkeyHint command="thread.toggleThreadStar" />
            </TooltipContent>
          </Tooltip>
        )}
        <MailThreadHeaderAction
          command="thread.toggleThreadRead"
          label={toggleReadLabel}
          onClick={onToggleRead}
        >
          {isUnread ? <MailOpenIcon /> : <MailIcon />}
        </MailThreadHeaderAction>
        {onReportSpam === undefined ? null : (
          <MailThreadHeaderAction
            command="thread.reportSpam"
            confirm={`Moves ${conversation} to Spam`}
            label="Report spam"
            onClick={onReportSpam}
          >
            <ShieldAlertIcon />
          </MailThreadHeaderAction>
        )}
        {destructiveAction === undefined ? null : (
          <MailThreadHeaderAction
            className={quietDestructiveClassName}
            command="thread.trashThread"
            confirm={trashConfirmation}
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
  onArchive?: () => void;
  onClose: () => void;
  onDeleteForever?: () => void;
  onMoveToInbox?: () => void;
  onPopOut?: () => void;
  onReportSpam?: () => void;
  onToggleRead: () => void;
  onToggleStar?: () => void;
  onTrash?: () => void;
}

/**
 * The open conversation's shortcuts, registered by the conversation itself
 * rather than by its buttons, so they hold however the buttons are placed.
 */
export const MailThreadCommands = ({
  onArchive,
  onClose,
  onDeleteForever,
  onMoveToInbox,
  onPopOut,
  onReportSpam,
  onToggleRead,
  onToggleStar,
  onTrash,
}: MailThreadCommandsProps) => {
  const destructiveAction = onDeleteForever ?? onTrash;
  // E archives a conversation in the Inbox and brings an archived one back,
  // as its button does.
  const inboxAction = onArchive ?? onMoveToInbox;

  useAppCommand("thread.close", onClose);
  useAppCommand("thread.archiveThread", () => inboxAction?.(), {
    enabled: inboxAction !== undefined,
  });
  useAppCommand("thread.toggleThreadStar", () => onToggleStar?.(), {
    enabled: onToggleStar !== undefined,
  });
  useAppCommand("thread.reportSpam", () => onReportSpam?.(), {
    enabled: onReportSpam !== undefined,
  });
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
}

/**
 * The header card a pop-out window shows above the conversation: its subject
 * and actions, sticking to the top as the messages scroll.
 */
const MailThreadHeader = ({
  onClose,
  showCloseButton = true,
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
          {actions.subject}
        </h1>
        <MailThreadActions dateClassName="text-sm" {...actions} />
      </div>
    </header>
  );
};

export default MailThreadHeader;
