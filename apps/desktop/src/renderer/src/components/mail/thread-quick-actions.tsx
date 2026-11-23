import { InboxIcon, MailIcon, MailOpenIcon, Trash2Icon } from "lucide-react";
import { m, useReducedMotionConfig } from "motion/react";

import { Button } from "@/components/ui/button";
import { getHotkeyAriaLabel, getHotkeyDisplay } from "@/hotkeys";
import { quietDestructiveClassName } from "@/lib/action-hierarchy";
import { MOTION_EASE, NO_MOTION } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { MailListActions } from "@/primitives/mail-list";

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
  name: string;
  subject: string;
  onDeleteForever?: () => void;
  onNotSpam?: () => void;
  onToggleRead?: () => void;
  onTrash?: () => void;
}

const MailThreadQuickActions = ({
  hotkeysEnabled,
  isRevealed,
  isUnread,
  name,
  onDeleteForever,
  onNotSpam,
  onToggleRead,
  onTrash,
  subject,
}: MailThreadQuickActionsProps) => {
  const shouldReduceMotion = useReducedMotionConfig();
  const toggleReadLabel = isUnread ? "Mark as read" : "Mark as unread";
  const toggleReadKeys = getHotkeyDisplay("mailbox.toggleThreadRead");
  const trashKeys = getHotkeyDisplay("mailbox.trashThread");
  const trashShortcutLabel = trashKeys.bindings.join(" / ");
  const destructiveLabel =
    onDeleteForever === undefined ? trashKeys.label : "Delete forever";
  const destructiveAction = onDeleteForever ?? onTrash;
  const destructiveName =
    onDeleteForever === undefined
      ? `Trash ${name}`
      : `Permanently delete ${name}`;
  const trimmedSubject = subject.trim();
  // Delete forever asks through useConfirm, whose confirming button is marked.
  const trashConfirmation =
    onDeleteForever === undefined
      ? `Moves ${trimmedSubject === "" ? "this conversation" : `“${trimmedSubject}”`} to Trash`
      : undefined;
  const hasSecondaryAction = [onNotSpam, destructiveAction].some(
    (action) => action !== undefined
  );
  const hasThreeActions =
    onNotSpam !== undefined && destructiveAction !== undefined;

  return (
    // Parked behind the row: the row slides off it rather than the other way
    // round, and `inert` keeps the covered buttons out of the focus order.
    <MailListActions
      className={cn(
        "bg-card absolute inset-y-0 right-0 z-0 grid grid-flow-col overflow-hidden rounded-r-md",
        hasSecondaryAction ? "grid-rows-2" : "grid-rows-1",
        hasThreeActions ? "w-27 grid-cols-[60px_48px]" : "w-15 grid-cols-[60px]"
      )}
      inert={!isRevealed}
      render={
        <m.div
          transition={
            shouldReduceMotion
              ? NO_MOTION
              : { delay: 0.05, duration: 0.18, ease: MOTION_EASE }
          }
          variants={quickActionsVariants}
        />
      }
    >
      <Button
        aria-keyshortcuts={
          hotkeysEnabled
            ? getHotkeyAriaLabel("mailbox.toggleThreadRead")
            : undefined
        }
        aria-label={`Mark ${name} as ${isUnread ? "read" : "unread"}`}
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
          aria-label={`Mark ${name} as not spam`}
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
          aria-label={destructiveName}
          className={cn(
            quickActionClassName,
            quietDestructiveClassName,
            hasThreeActions ? "row-span-2" : "pl-3"
          )}
          data-agent-confirm={trashConfirmation}
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
    </MailListActions>
  );
};

export default MailThreadQuickActions;
