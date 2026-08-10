import { ForwardIcon, ReplyAllIcon, ReplyIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { MailMessageAction } from "@/mail/reply-recipients";

export type { MailMessageAction } from "@/mail/reply-recipients";

interface MailMessageActionsProps {
  disabled?: boolean;
  onAction: (action: MailMessageAction) => void;
}

const MailMessageActions = ({
  disabled = false,
  onAction,
}: MailMessageActionsProps) => (
  <fieldset
    aria-label="Message actions"
    className="bg-card flex flex-wrap gap-1 p-4"
  >
    <Button
      disabled={disabled}
      onClick={() => onAction("reply")}
      variant="ghost"
    >
      <ReplyIcon data-icon="inline-start" />
      Reply
    </Button>
    <Button
      disabled={disabled}
      onClick={() => onAction("reply-all")}
      variant="ghost"
    >
      <ReplyAllIcon data-icon="inline-start" />
      Reply all
    </Button>
    <Button
      disabled={disabled}
      onClick={() => onAction("forward")}
      variant="ghost"
    >
      <ForwardIcon data-icon="inline-start" />
      Forward
    </Button>
  </fieldset>
);

export default MailMessageActions;
