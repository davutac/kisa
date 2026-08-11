import {
  ArrowLeftIcon,
  MailIcon,
  MailOpenIcon,
  SquareArrowOutUpRightIcon,
  Trash2Icon,
} from "lucide-react";

import MailRelativeTime from "@/components/mail/relative-time";
import { Button } from "@/components/ui/button";
import {
  AppCommand,
  getHotkeyAriaLabel,
  getHotkeyDisplay,
  useAppCommand,
} from "@/hotkeys";
import { cn } from "@/lib/utils";

interface MailThreadHeaderProps {
  isUnread: boolean;
  latestAt?: number;
  onClose: () => void;
  onPopOut?: () => void;
  onToggleRead: () => void;
  onTrash: () => void;
  showCloseButton?: boolean;
  subject: string;
}

const MailThreadHeader = ({
  isUnread,
  latestAt,
  onClose,
  onPopOut,
  onToggleRead,
  onTrash,
  showCloseButton = true,
  subject,
}: MailThreadHeaderProps) => {
  const toggleReadLabel = isUnread ? "Mark as read" : "Mark as unread";
  const closeDisplay = getHotkeyDisplay("thread.close");
  const popOutDisplay = getHotkeyDisplay("thread.popout");
  const toggleReadDisplay = getHotkeyDisplay("thread.toggleThreadRead");
  const trashDisplay = getHotkeyDisplay("thread.trashThread");

  useAppCommand("thread.close", onClose);
  useAppCommand("thread.toggleThreadRead", onToggleRead);
  useAppCommand("thread.trashThread", onTrash);

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
          <Button
            aria-keyshortcuts={getHotkeyAriaLabel("thread.close")}
            aria-label={closeDisplay.label}
            className="shrink-0"
            onClick={onClose}
            size="icon"
            title={`${closeDisplay.label} (${closeDisplay.bindings[0]})`}
            variant="secondary"
          >
            <ArrowLeftIcon />
          </Button>
        ) : null}
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">
          {subject}
        </h1>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            aria-keyshortcuts={getHotkeyAriaLabel("thread.toggleThreadRead")}
            aria-label={toggleReadLabel}
            onClick={onToggleRead}
            size="icon"
            title={`${toggleReadLabel} (${toggleReadDisplay.bindings[0]})`}
            type="button"
            variant="ghost"
          >
            {isUnread ? <MailOpenIcon /> : <MailIcon />}
          </Button>
          <Button
            aria-keyshortcuts={getHotkeyAriaLabel("thread.trashThread")}
            aria-label={trashDisplay.label}
            className="hover:bg-destructive/10 hover:text-destructive"
            onClick={onTrash}
            size="icon"
            title={`${trashDisplay.label} (${trashDisplay.bindings[0]})`}
            type="button"
            variant="ghost"
          >
            <Trash2Icon />
          </Button>
        </div>
        {latestAt === undefined ? null : (
          <MailRelativeTime
            className="text-muted-foreground ml-2 shrink-0 text-sm"
            timestamp={latestAt}
          />
        )}
        {onPopOut === undefined ? null : (
          <Button
            aria-keyshortcuts={getHotkeyAriaLabel("thread.popout")}
            aria-label={popOutDisplay.label}
            onClick={onPopOut}
            size="icon"
            title={`${popOutDisplay.label} (${popOutDisplay.bindings[0]})`}
            type="button"
            variant="ghost"
          >
            <SquareArrowOutUpRightIcon />
          </Button>
        )}
      </div>
    </header>
  );
};

export default MailThreadHeader;
