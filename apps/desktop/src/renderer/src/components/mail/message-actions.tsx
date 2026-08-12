import { ForwardIcon, ReplyAllIcon, ReplyIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getHotkeyAriaLabel, getHotkeyDisplay, HotkeyHint } from "@/hotkeys";
import type { MailMessageAction } from "@/mail/reply-recipients";

export type { MailMessageAction } from "@/mail/reply-recipients";

const MESSAGE_ACTIONS = [
  {
    action: "reply",
    command: "thread.replyToMessage",
    icon: ReplyIcon,
  },
  {
    action: "reply-all",
    command: "thread.replyAllToMessage",
    icon: ReplyAllIcon,
  },
  {
    action: "forward",
    command: "thread.forwardMessage",
    icon: ForwardIcon,
  },
] as const;

interface MailMessageActionsProps {
  disabled?: boolean;
  onAction: (action: MailMessageAction) => void;
  showReplyAll: boolean;
  targetLabel: string;
}

const MailMessageActions = ({
  disabled = false,
  onAction,
  showReplyAll,
  targetLabel,
}: MailMessageActionsProps) => (
  <fieldset
    aria-label={`Actions for ${targetLabel}`}
    className="bg-background flex items-stretch gap-px overflow-hidden"
  >
    {MESSAGE_ACTIONS.map(({ action, command, icon: ActionIcon }) => {
      if (action === "reply-all" && !showReplyAll) {
        return null;
      }

      const display = getHotkeyDisplay(command);
      return (
        <Button
          aria-keyshortcuts={getHotkeyAriaLabel(command)}
          disabled={disabled}
          key={action}
          onClick={() => onAction(action)}
          size="footer"
          title={`${display.label} (${display.bindings[0]})`}
          type="button"
          variant="secondary"
        >
          <ActionIcon data-icon="inline-start" />
          {display.label}
          <HotkeyHint className="ml-2" command={command} />
        </Button>
      );
    })}
  </fieldset>
);

export default MailMessageActions;
