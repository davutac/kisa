import { ChevronDownIcon } from "lucide-react";
import type { Ref } from "react";

import MailDate from "@/components/mail/mail-date";
import MailMessageParticipants from "@/components/mail/message-participants";
import { AccordionHeader, AccordionTrigger } from "@/components/ui/accordion";
import { useCalendar } from "@/hooks/use-calendar";
import { cn } from "@/lib/utils";
import { formatMailDate } from "@/mail/mail-date";
import type { ThreadMessage } from "@/shared/ipc/mail";

interface MailMessageHeaderProps {
  buttonRef?: Ref<HTMLButtonElement>;
  expanded: boolean;
  fallbackRecipient: string;
  message: ThreadMessage;
  selected: boolean;
}

const MailMessageHeader = ({
  buttonRef,
  expanded,
  fallbackRecipient,
  message,
  selected,
}: MailMessageHeaderProps) => {
  const calendar = useCalendar();
  // The time tells apart two messages from one sender, as the header shows it.
  const sentAt = formatMailDate(message.sentAt, calendar, "detailed");

  return (
    <header
      className={cn(
        "relative min-w-0 transition-colors",
        selected ? "bg-muted" : "bg-card"
      )}
    >
      {/* The heading holds only the trigger that covers the card, so it reads
        as the trigger's name. The link variant has no fill of its own, so
        only the header's hover and focus fills show across the whole card. */}
      <AccordionHeader
        render={({ children, ...props }) => <h2 {...props}>{children}</h2>}
      >
        <AccordionTrigger
          aria-current={selected ? "true" : undefined}
          aria-label={`${expanded ? "Collapse" : "Expand"} message from ${message.from}, ${sentAt}`}
          className="hover:bg-muted/50 focus-visible:bg-muted/70 absolute inset-0 h-auto cursor-pointer rounded-none border-0 p-0 transition-colors focus-visible:ring-0 active:not-aria-[haspopup]:scale-100"
          ref={buttonRef}
          variant="link"
        />
      </AccordionHeader>
      <div className="pointer-events-none relative flex min-w-0 items-start gap-3 p-4">
        <MailMessageParticipants
          className="min-w-0 flex-1"
          fallbackRecipient={fallbackRecipient}
          message={message}
        />
        <div className="flex shrink-0 items-center gap-1.5">
          <MailDate
            className="text-muted-foreground text-xs"
            timestamp={message.sentAt}
            tooltip={false}
            variant="detailed"
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
};

export default MailMessageHeader;
