import { ForwardIcon, ReplyAllIcon, ReplyIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getHotkeyAriaLabel, getHotkeyDisplay, HotkeyHint } from "@/hotkeys";
import type { MailMessageAction } from "@/mail/reply-recipients";

const ACTION_COPY = {
  forward: {
    command: "thread.forwardMessage",
    icon: ForwardIcon,
    label: "Continue forwarding",
  },
  reply: {
    command: "thread.replyToMessage",
    icon: ReplyIcon,
    label: "Continue reply",
  },
  "reply-all": {
    command: "thread.replyAllToMessage",
    icon: ReplyAllIcon,
    label: "Continue reply all",
  },
} as const;

const MailThreadDraftActions = ({
  action,
  disabled,
  onContinue,
  onDiscard,
  targetAvailable = true,
}: {
  action: MailMessageAction;
  disabled: boolean;
  onContinue: () => void;
  onDiscard: () => void;
  targetAvailable?: boolean;
}) => {
  const { command, icon: ActionIcon, label } = ACTION_COPY[action];
  const display = getHotkeyDisplay(command);

  return (
    <section
      aria-label="Saved draft"
      className="bg-background flex items-stretch overflow-hidden"
    >
      {targetAvailable ? (
        <Button
          aria-keyshortcuts={getHotkeyAriaLabel(command)}
          disabled={disabled}
          onClick={onContinue}
          size="footer"
          title={`${display.label} (${display.bindings[0]})`}
          type="button"
          variant="secondary"
        >
          <ActionIcon data-icon="inline-start" />
          {label}
          <HotkeyHint className="ml-2" command={command} />
        </Button>
      ) : (
        <p className="bg-card text-muted-foreground flex min-h-12 min-w-0 flex-1 items-center px-4 text-sm">
          The original message for this draft is unavailable.
        </p>
      )}
      <Button
        aria-label="Discard draft"
        className="border-background border-l"
        disabled={disabled}
        onClick={onDiscard}
        size="footer-icon"
        title="Discard draft"
        type="button"
        variant="secondary"
      >
        <Trash2Icon />
      </Button>
    </section>
  );
};

export default MailThreadDraftActions;
