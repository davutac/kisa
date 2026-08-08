import { useHotkey } from "@tanstack/react-hotkeys";
import {
  ArrowLeftIcon,
  MailIcon,
  MailOpenIcon,
  Trash2Icon,
} from "lucide-react";

import MailLabelBadges from "@/components/mail/label-badges";
import MailRelativeTime from "@/components/mail/relative-time";
import { Button } from "@/components/ui/button";
import { useMailboxStore } from "@/state/mailbox";

interface MailThreadHeaderProps {
  accountId: string;
  isUnread: boolean;
  labels: readonly string[];
  latestAt?: number;
  onToggleRead: () => void;
  onTrash: () => void;
  subject: string;
}

const MailThreadHeader = ({
  accountId,
  isUnread,
  labels,
  latestAt,
  onToggleRead,
  onTrash,
  subject,
}: MailThreadHeaderProps) => {
  const closeThread = useMailboxStore((state) => state.closeThread);
  const toggleReadLabel = isUnread ? "Mark as read" : "Mark as unread";

  useHotkey("Escape", closeThread, { requireReset: true });

  return (
    // Sticking at top-0 with an opaque pt-4 gutter reads as a top-4 offset
    // while keeping messages from showing through the gutter, the card's
    // rounded corners and the 1px flex gap as they scroll up behind it.
    <header className="bg-background after:bg-background sticky top-0 z-10 pt-4 after:absolute after:inset-x-0 after:top-full after:h-px">
      <div className="bg-card flex min-w-0 items-center gap-2 rounded-t-lg p-4">
        <Button
          aria-label="Back to inbox"
          className="shrink-0"
          onClick={closeThread}
          size="icon"
          title="Back to inbox (Esc)"
          variant="secondary"
        >
          <ArrowLeftIcon />
        </Button>
        <h1 className="min-w-0 truncate text-lg font-semibold">{subject}</h1>
        <div className="hidden min-w-0 gap-1 sm:flex">
          <MailLabelBadges accountId={accountId} labels={labels} />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
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
            className="text-muted-foreground ml-2 text-sm"
            timestamp={latestAt}
          />
        )}
      </div>
    </header>
  );
};

export default MailThreadHeader;
