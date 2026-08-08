import { EllipsisIcon } from "lucide-react";
import { useState } from "react";

import MailMessageBody from "@/components/mail/message-body";
import { Button } from "@/components/ui/button";
import type { GmailThreadMessage } from "@/shared/ipc/mail";

const FORWARDED_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

interface MailForwardedMessageProps {
  message: GmailThreadMessage;
}

const MailForwardedMessage = ({ message }: MailForwardedMessageProps) => {
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <div className="bg-card px-4 py-2">
        <Button
          aria-expanded="false"
          aria-label="Show forwarded message"
          onClick={() => setExpanded(true)}
          size="icon"
          title="Show forwarded message"
          type="button"
          variant="outline"
        >
          <EllipsisIcon />
        </Button>
      </div>
    );
  }

  return (
    <section aria-label="Forwarded message" className="flex flex-col gap-px">
      <div className="bg-card p-4 text-sm">
        <p className="text-muted-foreground mb-2">
          ---------- Forwarded message ---------
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-2">
          <dt className="font-medium">From:</dt>
          <dd className="min-w-0 break-words">{message.from}</dd>
          <dt className="font-medium">Date:</dt>
          <dd>{FORWARDED_DATE_FORMAT.format(new Date(message.sentAt))}</dd>
          <dt className="font-medium">Subject:</dt>
          <dd className="min-w-0 break-words">{message.subject}</dd>
          <dt className="font-medium">To:</dt>
          <dd className="min-w-0 break-words">{message.to}</dd>
          {message.cc === undefined ? null : (
            <>
              <dt className="font-medium">Cc:</dt>
              <dd className="min-w-0 break-words">{message.cc}</dd>
            </>
          )}
        </dl>
      </div>
      <MailMessageBody
        allowRemoteImages={false}
        body={message.body}
        fallbackText={message.snippet}
      />
    </section>
  );
};

export default MailForwardedMessage;
