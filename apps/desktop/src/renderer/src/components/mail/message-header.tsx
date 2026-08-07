import { ChevronDownIcon } from "lucide-react";

import MailMessageParticipants from "@/components/mail/message-participants";
import MailRelativeTime from "@/components/mail/relative-time";
import { cn } from "@/lib/utils";
import type { GmailThreadMessage } from "@/shared/ipc/mail";

interface MailMessageHeaderProps {
  expanded: boolean;
  fallbackRecipient: string;
  message: GmailThreadMessage;
  onToggle: () => void;
}

const MailMessageHeader = ({
  expanded,
  fallbackRecipient,
  message,
  onToggle,
}: MailMessageHeaderProps) => (
  <header className="bg-card relative min-w-0">
    <button
      aria-expanded={expanded}
      aria-label={`${expanded ? "Collapse" : "Expand"} message from ${message.from}`}
      className="hover:bg-muted/50 focus-visible:ring-ring/30 absolute inset-0 cursor-pointer transition-colors outline-none focus-visible:ring-2"
      onClick={onToggle}
      type="button"
    />
    <div className="pointer-events-none relative flex min-w-0 items-start gap-3 p-4">
      <MailMessageParticipants
        className="min-w-0 flex-1"
        fallbackRecipient={fallbackRecipient}
        message={message}
      />
      <div className="flex shrink-0 items-center gap-1.5">
        <MailRelativeTime
          className="text-muted-foreground text-xs"
          timestamp={message.sentAt}
        />
        <ChevronDownIcon
          aria-hidden="true"
          className={cn(
            "text-muted-foreground size-3 transition-transform",
            expanded && "rotate-180"
          )}
        />
      </div>
    </div>
  </header>
);

export default MailMessageHeader;
