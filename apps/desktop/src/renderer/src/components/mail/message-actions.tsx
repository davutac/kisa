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
    className="bg-background flex items-stretch gap-px overflow-hidden"
  >
    <Button
      disabled={disabled}
      onClick={() => onAction("reply")}
      size="footer"
      type="button"
      variant="secondary"
    >
      <ReplyIcon data-icon="inline-start" />
      Reply
    </Button>
    <Button
      disabled={disabled}
      onClick={() => onAction("reply-all")}
      size="footer"
      type="button"
      variant="secondary"
    >
      <ReplyAllIcon data-icon="inline-start" />
      Reply all
    </Button>
    <Button
      disabled={disabled}
      onClick={() => onAction("forward")}
      size="footer"
      type="button"
      variant="secondary"
    >
      <ForwardIcon data-icon="inline-start" />
      Forward
    </Button>
  </fieldset>
);

export default MailMessageActions;
