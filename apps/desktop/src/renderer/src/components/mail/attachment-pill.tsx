import { PaperclipIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { GmailAttachmentSummary } from "@/shared/ipc/mail";

interface MailAttachmentPillProps {
  attachment: GmailAttachmentSummary;
}

const MailAttachmentPill = ({ attachment }: MailAttachmentPillProps) => (
  <Badge
    className="bg-muted text-muted-foreground max-w-56 [&>svg]:size-2.5! [&>svg]:shrink-0"
    variant="secondary"
  >
    <PaperclipIcon aria-hidden="true" data-icon="inline-start" />
    <span className="min-w-0 truncate">{attachment.filename}</span>
  </Badge>
);

export default MailAttachmentPill;
