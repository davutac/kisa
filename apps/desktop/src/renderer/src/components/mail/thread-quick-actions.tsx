import { MailIcon, MailOpenIcon, Trash2Icon } from "lucide-react";
import { m, useReducedMotion } from "motion/react";

import { Button } from "@/components/ui/button";
import { getHotkeyAriaLabel, getHotkeyDisplay } from "@/hotkeys";
import { MOTION_EASE, NO_MOTION } from "@/lib/motion";

/** How far the thread row slides left to uncover the actions. */
export const MAIL_THREAD_QUICK_ACTIONS_WIDTH = 48;

/**
 * The panel runs this much further left than the row slides, so the row rests
 * on top of its edge instead of meeting it at a seam.
 */
const QUICK_ACTIONS_OVERLAP = 12;

const quickActionsVariants = {
  idle: { opacity: 0 },
  revealed: { opacity: 1 },
};

const quickActionClassName =
  "h-auto w-full min-w-0 flex-1 rounded-none text-muted-foreground";

// The buttons run the full panel width so a hover fill reaches under the row's
// rounded corners, and the padding puts their icons back on the centre of the
// strip the slide actually uncovers.
const quickActionStyle = { paddingLeft: QUICK_ACTIONS_OVERLAP };

interface MailThreadQuickActionsProps {
  hotkeysEnabled: boolean;
  isRevealed: boolean;
  isUnread: boolean;
  onToggleRead?: () => void;
  onTrash?: () => void;
}

const MailThreadQuickActions = ({
  hotkeysEnabled,
  isRevealed,
  isUnread,
  onToggleRead,
  onTrash,
}: MailThreadQuickActionsProps) => {
  const shouldReduceMotion = useReducedMotion();
  const toggleReadLabel = isUnread ? "Mark as read" : "Mark as unread";
  const toggleReadKeys = getHotkeyDisplay("mailbox.toggleThreadRead");
  const trashKeys = getHotkeyDisplay("mailbox.trashThread");
  const trashShortcutLabel = trashKeys.bindings
    .map((keys) => keys.join("+"))
    .join(" / ");

  return (
    // Parked behind the row: the row slides off it rather than the other way
    // round, and `inert` keeps the covered buttons out of the focus order.
    <m.div
      className="bg-card absolute inset-y-0 right-0 z-0 flex flex-col overflow-hidden rounded-r-md"
      inert={!isRevealed}
      style={{
        width: MAIL_THREAD_QUICK_ACTIONS_WIDTH + QUICK_ACTIONS_OVERLAP,
      }}
      transition={
        shouldReduceMotion
          ? NO_MOTION
          : { delay: 0.05, duration: 0.18, ease: MOTION_EASE }
      }
      variants={quickActionsVariants}
    >
      <Button
        aria-keyshortcuts={
          hotkeysEnabled
            ? getHotkeyAriaLabel("mailbox.toggleThreadRead")
            : undefined
        }
        aria-label={toggleReadLabel}
        className={`${quickActionClassName} hover:text-foreground`}
        onClick={onToggleRead}
        size="icon"
        style={quickActionStyle}
        title={
          hotkeysEnabled
            ? `${toggleReadLabel} (${toggleReadKeys.bindings[0]?.join("+")})`
            : toggleReadLabel
        }
        variant="ghost"
      >
        {isUnread ? <MailOpenIcon /> : <MailIcon />}
      </Button>
      <Button
        aria-keyshortcuts={
          hotkeysEnabled ? getHotkeyAriaLabel("mailbox.trashThread") : undefined
        }
        aria-label="Move to trash"
        className={`${quickActionClassName} hover:bg-destructive/10 hover:text-destructive`}
        onClick={onTrash}
        size="icon"
        style={quickActionStyle}
        title={
          hotkeysEnabled
            ? `${trashKeys.label} (${trashShortcutLabel})`
            : trashKeys.label
        }
        variant="ghost"
      >
        <Trash2Icon />
      </Button>
    </m.div>
  );
};

export default MailThreadQuickActions;
