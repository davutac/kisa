import {
  ArchiveIcon,
  InboxIcon,
  MailIcon,
  MailOpenIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react";
import { m, useReducedMotionConfig } from "motion/react";

import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { getHotkeyAriaLabel, getHotkeyDisplay } from "@/hotkeys";
import type { HotkeyCommandId } from "@/hotkeys";
import { quietDestructiveClassName } from "@/lib/action-hierarchy";
import { MOTION_EASE, NO_MOTION } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { MailListActions } from "@/primitives/mail-list";

/** Width of each action column uncovered by the thread row. */
const MAIL_THREAD_QUICK_ACTION_COLUMN_WIDTH = 48;

interface QuickActionPresence {
  readonly hasArchive: boolean;
  readonly hasDestructive: boolean;
  /** Read is always there; Not spam in Spam, or Star elsewhere, joins it. */
  readonly hasSecondary: boolean;
}

/**
 * The actions stand in two columns of two: Read with Star (or Not spam),
 * then Archive with Trash. Two actions share one column, and an action alone
 * in its column fills it.
 */
const getQuickActionColumns = ({
  hasArchive,
  hasDestructive,
  hasSecondary,
}: QuickActionPresence) => {
  const first = hasSecondary ? 2 : 1;
  const second = Number(hasArchive) + Number(hasDestructive);

  return second === 0 || first + second <= 2
    ? { count: 1, first: first + second, second: 0 }
    : { count: 2, first, second };
};

export const getMailThreadQuickActionsWidth = (
  presence: QuickActionPresence
): number =>
  MAIL_THREAD_QUICK_ACTION_COLUMN_WIDTH * getQuickActionColumns(presence).count;

const quickActionsVariants = {
  idle: { opacity: 0 },
  revealed: { opacity: 1 },
};

const quickActionClassName =
  "h-auto w-full min-w-0 rounded-none text-muted-foreground";
// The first column sits under the row's rounded edge, so its icons start
// past it.
const overlappingQuickActionClassName = `${quickActionClassName} pl-3`;

/** The keys a revealed row's action answers to, only while the row has focus. */
const shortcutOf = (hotkeysEnabled: boolean, command: HotkeyCommandId) =>
  hotkeysEnabled ? getHotkeyAriaLabel(command) : undefined;

const titleOf = (
  hotkeysEnabled: boolean,
  label: string,
  command: HotkeyCommandId
): string =>
  hotkeysEnabled
    ? `${label} (${getHotkeyDisplay(command).bindings.join(" / ")})`
    : label;

/**
 * In one column every action is under the row's edge; in two, only the first
 * column's. A column's lone action fills its height.
 */
const getColumnClassNames = (
  columns: ReturnType<typeof getQuickActionColumns>
) => {
  const isTwoColumns = columns.count === 2;

  return {
    first: cn(
      overlappingQuickActionClassName,
      isTwoColumns && columns.first === 1 && "row-span-2"
    ),
    grid: cn(
      Math.max(columns.first, columns.second) > 1
        ? "grid-rows-2"
        : "grid-rows-1",
      isTwoColumns ? "w-27 grid-cols-[60px_48px]" : "w-15 grid-cols-[60px]"
    ),
    second: isTwoColumns
      ? cn(quickActionClassName, columns.second === 1 && "row-span-2")
      : overlappingQuickActionClassName,
  };
};

/** Trash, or Delete forever in Spam and Trash, named for its row. */
const getDestructiveCopy = (
  isDeleteForever: boolean,
  name: string,
  subject: string
) => {
  const trimmedSubject = subject.trim();
  const conversation =
    trimmedSubject === "" ? "this conversation" : `“${trimmedSubject}”`;

  return isDeleteForever
    ? {
        // Delete forever asks through useConfirm, whose confirming button is
        // marked instead.
        confirmation: undefined,
        label: "Delete forever",
        name: `Permanently delete ${name}`,
      }
    : {
        confirmation: `Moves ${conversation} to Trash`,
        label: getHotkeyDisplay("mailbox.trashThread").label,
        name: `Trash ${name}`,
      };
};

/** Read's partner in the first column: Not spam in Spam, Star elsewhere. */
const QuickActionSecondary = ({
  className,
  hotkeysEnabled,
  isStarred,
  name,
  onNotSpam,
  onToggleStar,
}: {
  readonly className: string;
  readonly hotkeysEnabled: boolean;
  readonly isStarred: boolean;
  readonly name: string;
  readonly onNotSpam?: () => void;
  readonly onToggleStar?: () => void;
}) => {
  if (onNotSpam !== undefined) {
    return (
      <Button
        aria-label={`Mark ${name} as not spam`}
        className={`${className} hover:text-foreground`}
        onClick={onNotSpam}
        size="icon"
        title="Not spam"
        variant="ghost"
      >
        <InboxIcon />
      </Button>
    );
  }
  if (onToggleStar === undefined) {
    return null;
  }

  return (
    <Toggle
      aria-keyshortcuts={shortcutOf(hotkeysEnabled, "mailbox.toggleThreadStar")}
      aria-label={`Star ${name}`}
      className={`${className} hover:text-foreground`}
      onPressedChange={onToggleStar}
      pressed={isStarred}
      pressedVariant="ghost"
      title={titleOf(
        hotkeysEnabled,
        isStarred ? "Remove star" : "Star",
        "mailbox.toggleThreadStar"
      )}
    >
      <StarIcon className="group-data-pressed/button:fill-current" />
    </Toggle>
  );
};

interface MailThreadQuickActionsProps {
  hotkeysEnabled: boolean;
  isRevealed: boolean;
  isStarred?: boolean;
  isUnread: boolean;
  name: string;
  subject: string;
  onArchive?: () => void;
  onDeleteForever?: () => void;
  onNotSpam?: () => void;
  onToggleRead?: () => void;
  onToggleStar?: () => void;
  onTrash?: () => void;
}

const MailThreadQuickActions = ({
  hotkeysEnabled,
  isRevealed,
  isStarred = false,
  isUnread,
  name,
  onArchive,
  onDeleteForever,
  onNotSpam,
  onToggleRead,
  onToggleStar,
  onTrash,
  subject,
}: MailThreadQuickActionsProps) => {
  const shouldReduceMotion = useReducedMotionConfig();
  const destructiveAction = onDeleteForever ?? onTrash;
  const destructive = getDestructiveCopy(
    onDeleteForever !== undefined,
    name,
    subject
  );
  const columnClassNames = getColumnClassNames(
    getQuickActionColumns({
      hasArchive: onArchive !== undefined,
      hasDestructive: destructiveAction !== undefined,
      hasSecondary: (onNotSpam ?? onToggleStar) !== undefined,
    })
  );

  return (
    // Parked behind the row: the row slides off it rather than the other way
    // round, and `inert` keeps the covered buttons out of the focus order.
    <MailListActions
      className={cn(
        "bg-card absolute inset-y-0 right-0 z-0 grid grid-flow-col overflow-hidden rounded-r-md",
        columnClassNames.grid
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
        aria-keyshortcuts={shortcutOf(
          hotkeysEnabled,
          "mailbox.toggleThreadRead"
        )}
        aria-label={`Mark ${name} as ${isUnread ? "read" : "unread"}`}
        className={`${columnClassNames.first} hover:text-foreground`}
        onClick={onToggleRead}
        size="icon"
        title={titleOf(
          hotkeysEnabled,
          isUnread ? "Mark as read" : "Mark as unread",
          "mailbox.toggleThreadRead"
        )}
        variant="ghost"
      >
        {isUnread ? <MailOpenIcon /> : <MailIcon />}
      </Button>
      <QuickActionSecondary
        className={columnClassNames.first}
        hotkeysEnabled={hotkeysEnabled}
        isStarred={isStarred}
        name={name}
        onNotSpam={onNotSpam}
        onToggleStar={onToggleStar}
      />
      {onArchive === undefined ? null : (
        <Button
          aria-keyshortcuts={shortcutOf(
            hotkeysEnabled,
            "mailbox.archiveThread"
          )}
          aria-label={`Archive ${name}`}
          className={`${columnClassNames.second} hover:text-foreground`}
          onClick={onArchive}
          size="icon"
          title={titleOf(hotkeysEnabled, "Archive", "mailbox.archiveThread")}
          variant="ghost"
        >
          <ArchiveIcon />
        </Button>
      )}
      {destructiveAction === undefined ? null : (
        <Button
          aria-keyshortcuts={shortcutOf(hotkeysEnabled, "mailbox.trashThread")}
          aria-label={destructive.name}
          className={cn(columnClassNames.second, quietDestructiveClassName)}
          data-agent-confirm={destructive.confirmation}
          onClick={destructiveAction}
          size="icon"
          title={titleOf(
            hotkeysEnabled,
            destructive.label,
            "mailbox.trashThread"
          )}
          variant="ghost"
        >
          <Trash2Icon />
        </Button>
      )}
    </MailListActions>
  );
};

export default MailThreadQuickActions;
