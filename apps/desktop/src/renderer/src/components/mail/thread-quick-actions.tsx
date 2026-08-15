import { InboxIcon, MailIcon, MailOpenIcon, Trash2Icon } from "lucide-react";
import { m } from "motion/react";

import { Button } from "@/components/ui/button";
import { getHotkeyAriaLabel, getHotkeyDisplay } from "@/hotkeys";
import { MOTION_EASE, NO_MOTION, useShouldReduceMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Width of each action column uncovered by the thread row. */
const MAIL_THREAD_QUICK_ACTION_COLUMN_WIDTH = 48;

export const getMailThreadQuickActionsWidth = (
  hasNotSpamAction: boolean,
  hasDestructiveAction: boolean
): number =>
  MAIL_THREAD_QUICK_ACTION_COLUMN_WIDTH *
  (hasNotSpamAction && hasDestructiveAction ? 2 : 1);

const quickActionsVariants = {
  idle: { opacity: 0 },
  revealed: { opacity: 1 },
};

const quickActionClassName =
  "h-auto w-full min-w-0 rounded-none text-muted-foreground";
const overlappingQuickActionClassName = `${quickActionClassName} pl-3`;

interface MailThreadQuickActionsProps {
  hotkeysEnabled: boolean;
  isRevealed: boolean;
  isUnread: boolean;
  onDeleteSpam?: () => void;
  onNotSpam?: () => void;
  onToggleRead?: () => void;
  onTrash?: () => void;
}

const MailThreadQuickActions = ({
  hotkeysEnabled,
  isRevealed,
  isUnread,
  onDeleteSpam,
  onNotSpam,
  onToggleRead,
  onTrash,
}: MailThreadQuickActionsProps) => {
  const shouldReduceMotion = useShouldReduceMotion();
  const toggleReadLabel = isUnread ? "Mark as read" : "Mark as unread";
  const toggleReadKeys = getHotkeyDisplay("mailbox.toggleThreadRead");
  const trashKeys = getHotkeyDisplay("mailbox.trashThread");
  const trashShortcutLabel = trashKeys.bindings.join(" / ");
  const destructiveLabel =
    onDeleteSpam === undefined ? trashKeys.label : "Delete forever";
  const destructiveAction = onDeleteSpam ?? onTrash;
  const hasSecondaryAction = [onNotSpam, destructiveAction].some(
    (action) => action !== undefined
  );
  const hasThreeActions =
    onNotSpam !== undefined && destructiveAction !== undefined;

  return (
    // Parked behind the row: the row slides off it rather than the other way
    // round, and `inert` keeps the covered buttons out of the focus order.
    <m.div
      className={cn(
        "bg-card absolute inset-y-0 right-0 z-0 grid grid-flow-col overflow-hidden rounded-r-md",
        hasSecondaryAction ? "grid-rows-2" : "grid-rows-1",
        hasThreeActions ? "w-27 grid-cols-[60px_48px]" : "w-15 grid-cols-[60px]"
      )}
      inert={!isRevealed}
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
        className={`${overlappingQuickActionClassName} hover:text-foreground`}
        onClick={onToggleRead}
        size="icon"
        title={
          hotkeysEnabled
            ? `${toggleReadLabel} (${toggleReadKeys.bindings[0]})`
            : toggleReadLabel
        }
        variant="ghost"
      >
        {isUnread ? <MailOpenIcon /> : <MailIcon />}
      </Button>
      {onNotSpam === undefined ? null : (
        <Button
          aria-label="Not spam"
          className={`${overlappingQuickActionClassName} hover:text-foreground`}
          onClick={onNotSpam}
          size="icon"
          title="Not spam"
          variant="ghost"
        >
          <InboxIcon />
        </Button>
      )}
      {destructiveAction === undefined ? null : (
        <Button
          aria-keyshortcuts={
            hotkeysEnabled
              ? getHotkeyAriaLabel("mailbox.trashThread")
              : undefined
          }
          aria-label={destructiveLabel}
          className={cn(
            quickActionClassName,
            "hover:bg-destructive/10 hover:text-destructive",
            hasThreeActions ? "row-span-2" : "pl-3"
          )}
          onClick={destructiveAction}
          size="icon"
          title={
            hotkeysEnabled
              ? `${destructiveLabel} (${trashShortcutLabel})`
              : destructiveLabel
          }
          variant="ghost"
        >
          <Trash2Icon />
        </Button>
      )}
    </m.div>
  );
};

export default MailThreadQuickActions;
