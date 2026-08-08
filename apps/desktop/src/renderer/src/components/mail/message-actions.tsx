import { ForwardIcon, ReplyAllIcon, ReplyIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { MailMessageAction } from "@/mail/reply-recipients";

export type { MailMessageAction } from "@/mail/reply-recipients";

interface MailMessageActionsProps {
  onAction: (action: MailMessageAction) => void;
}

const MailMessageActions = ({ onAction }: MailMessageActionsProps) => (
  <fieldset
    aria-label="Message actions"
    className="bg-card flex flex-wrap gap-1 p-4"
  >
    <Button onClick={() => onAction("reply")} variant="ghost">
      <ReplyIcon data-icon="inline-start" />
      Reply
    </Button>
    <Button onClick={() => onAction("reply-all")} variant="ghost">
      <ReplyAllIcon data-icon="inline-start" />
      Reply all
    </Button>
    <Button onClick={() => onAction("forward")} variant="ghost">
      <ForwardIcon data-icon="inline-start" />
      Forward
    </Button>
  </fieldset>
);

export default MailMessageActions;
