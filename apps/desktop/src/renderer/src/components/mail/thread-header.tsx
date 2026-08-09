import {
  AppWindowIcon,
  ArrowLeftIcon,
  MailIcon,
  MailOpenIcon,
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

  useAppCommand("thread.close", onClose);

  return (
    // Sticking at top-0 with an opaque pt-4 gutter reads as a top-4 offset
    // while keeping messages from showing through the gutter, the card's
    // rounded corners and the 1px flex gap as they scroll up behind it.
    <header className="bg-background after:bg-background sticky top-0 z-10 pt-4 after:absolute after:inset-x-0 after:top-full after:h-px">
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
            title={`${closeDisplay.label} (${closeDisplay.bindings[0]?.join("+")})`}
            variant="secondary"
          >
            <ArrowLeftIcon />
          </Button>
        ) : null}
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">
          {subject}
        </h1>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {onPopOut === undefined ? null : (
            <Button
              aria-keyshortcuts={getHotkeyAriaLabel("thread.popout")}
              aria-label={popOutDisplay.label}
              onClick={onPopOut}
              size="icon"
              title={`${popOutDisplay.label} (${popOutDisplay.bindings[0]?.join("+")})`}
              type="button"
              variant="ghost"
            >
              <AppWindowIcon />
            </Button>
          )}
          <Button
            aria-label={toggleReadLabel}
            onClick={onToggleRead}
            size="icon"
            title={toggleReadLabel}
            type="button"
            variant="ghost"
          >
            {isUnread ? <MailOpenIcon /> : <MailIcon />}
          </Button>
          <Button
            aria-label="Move to trash"
            className="hover:bg-destructive/10 hover:text-destructive"
            onClick={onTrash}
            size="icon"
            title="Move to trash"
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
      </div>
    </header>
  );
};

export default MailThreadHeader;
