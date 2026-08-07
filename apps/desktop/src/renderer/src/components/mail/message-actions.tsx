import { ForwardIcon, ReplyAllIcon, ReplyIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export type MailMessageAction = "forward" | "reply" | "reply-all";

interface MailMessageActionsProps {
  onAction: (action: MailMessageAction) => void;
}

const MailMessageActions = ({ onAction }: MailMessageActionsProps) => (
  <fieldset
    aria-label="Message actions"
    className="bg-card flex flex-wrap gap-1 p-4"
  >
    <Button onClick={() => onAction("reply")} size="sm" variant="ghost">
      <ReplyIcon data-icon="inline-start" />
      Reply
    </Button>
    <Button onClick={() => onAction("reply-all")} size="sm" variant="ghost">
      <ReplyAllIcon data-icon="inline-start" />
      Reply all
    </Button>
    <Button onClick={() => onAction("forward")} size="sm" variant="ghost">
      <ForwardIcon data-icon="inline-start" />
      Forward
    </Button>
  </fieldset>
);

export default MailMessageActions;
