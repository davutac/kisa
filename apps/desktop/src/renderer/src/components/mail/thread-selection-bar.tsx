import {
  ArchiveIcon,
  MailIcon,
  MailOpenIcon,
  ShieldAlertIcon,
  StarIcon,
  TagIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { m, useReducedMotionConfig } from "motion/react";
import { useMemo, useState } from "react";
import type { ComponentProps } from "react";

import {
  createMenuController,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarSeparator,
} from "@/components/ui/toolbar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useInstanceValue } from "@/hooks/use-instance-value";
import { getHotkeyAriaLabel, HotkeyHint, useAppCommand } from "@/hotkeys";
import type { HotkeyCommandId } from "@/hotkeys";
import { quietDestructiveClassName } from "@/lib/action-hierarchy";
import { runWithCleanup } from "@/lib/run-with-cleanup";
import { cn } from "@/lib/utils";
import { getBulkLabelGroups } from "@/mail/bulk-thread-selection";
import type { ThreadActions } from "@/mail/use-thread-actions";
import type { MailThreadSummary } from "@/shared/ipc/mail";
import { useLabelCatalogs } from "@/state/labels";

interface ThreadSelectionBarProps {
  actions: ThreadActions;
  /** Every selected conversation that can have a star already has one. */
  isStarred: boolean;
  onArchive?: () => void;
  onClear: () => void;
  /** Confirms first, so the bar waits for it. */
  onDeleteForever?: () => Promise<void>;
  onReportSpam?: () => void;
  onToggleStar?: () => void;
  onTrash?: () => void;
  threads: readonly MailThreadSummary[];
}

const SelectionBarButton = ({
  command,
  hint,
  ...props
}: ComponentProps<typeof ToolbarButton> & {
  readonly command?: HotkeyCommandId;
  readonly hint: string;
}) => (
  <Tooltip>
    <TooltipTrigger render={<ToolbarButton {...props} />} />
    <TooltipContent className="flex items-center gap-2">
      {hint}
      {command === undefined ? null : <HotkeyHint command={command} />}
    </TooltipContent>
  </Tooltip>
);

const SelectionStarButton = ({
  disabled,
  isStarred,
  onToggle,
}: {
  readonly disabled: boolean;
  /** Every selected conversation already has a star, so it removes them. */
  readonly isStarred: boolean;
  readonly onToggle: () => void;
}) => (
  <SelectionBarButton
    aria-keyshortcuts={getHotkeyAriaLabel("mailbox.toggleThreadStar")}
    aria-label={
      isStarred
        ? "Remove stars from selected conversations"
        : "Star selected conversations"
    }
    className="size-8 rounded-full"
    command="mailbox.toggleThreadStar"
    disabled={disabled}
    hint={isStarred ? "Remove star" : "Star"}
    onClick={onToggle}
  >
    <StarIcon className={cn(isStarred && "fill-current")} />
  </SelectionBarButton>
);

/** Report spam and Trash (or Delete forever), set apart from the rest. */
const SelectionRemovalActions = ({
  conversations,
  disabled,
  onDeleteForever,
  onReportSpam,
  onTrash,
}: {
  readonly conversations: string;
  readonly disabled: boolean;
  readonly onDeleteForever?: () => void;
  readonly onReportSpam?: () => void;
  readonly onTrash?: () => void;
}) => {
  const isDeleteForever = onDeleteForever !== undefined;
  const destructiveAction = onDeleteForever ?? onTrash;

  if (destructiveAction === undefined && onReportSpam === undefined) {
    return null;
  }

  return (
    <>
      <ToolbarSeparator className="bg-border mx-0.5 h-5" />
      {onReportSpam === undefined ? null : (
        <SelectionBarButton
          aria-keyshortcuts={getHotkeyAriaLabel("mailbox.reportSpam")}
          aria-label="Report selected conversations as spam"
          className="size-8 rounded-full"
          command="mailbox.reportSpam"
          data-agent-confirm={`Moves ${conversations} to Spam`}
          disabled={disabled}
          hint="Report spam"
          onClick={onReportSpam}
        >
          <ShieldAlertIcon />
        </SelectionBarButton>
      )}
      {destructiveAction === undefined ? null : (
        <SelectionBarButton
          aria-label={
            isDeleteForever
              ? "Permanently delete selected conversations"
              : "Move selected conversations to trash"
          }
          className={cn("size-8 rounded-full", quietDestructiveClassName)}
          // Delete forever asks through useConfirm, whose confirming
          // button is marked instead.
          data-agent-confirm={
            isDeleteForever ? undefined : `Moves ${conversations} to Trash`
          }
          disabled={disabled}
          hint={isDeleteForever ? "Delete forever" : "Move to trash"}
          onClick={destructiveAction}
        >
          <Trash2Icon />
        </SelectionBarButton>
      )}
    </>
  );
};

const ThreadSelectionBar = ({
  actions,
  isStarred,
  onArchive,
  onClear,
  onDeleteForever,
  onReportSpam,
  onToggleStar,
  onTrash,
  threads,
}: ThreadSelectionBarProps) => {
  const shouldReduceMotion = useReducedMotionConfig();
  const catalogs = useLabelCatalogs();
  const [isLabelPickerOpen, setIsLabelPickerOpen] = useState(false);
  const labelPicker = useInstanceValue(createMenuController);
  const [isPending, setIsPending] = useState(false);
  const labelGroups = useMemo(
    () => getBulkLabelGroups(threads, catalogs),
    [catalogs, threads]
  );
  const isLoadingLabels = threads.some(
    (thread) => !catalogs.has(thread.accountId)
  );

  useAppCommand(
    "mailbox.manageLabels",
    () => {
      void labelPicker.open({ focus: "first" });
    },
    { enabled: !isLabelPickerOpen && !isPending }
  );

  const run = async (action: () => Promise<void>) => {
    setIsPending(true);
    await runWithCleanup(action, () => {
      setIsPending(false);
    });
  };

  const conversations = `${threads.length} conversation${threads.length === 1 ? "" : "s"}`;
  // The bar rests 16px (bottom-4) above the mailbox's edge. Sliding further
  // than that would push it past the edge, overflowing the scrolling <main>
  // and flashing a second scrollbar beside the list's own.
  const enterOffsetY = 12;

  return (
    <Toolbar
      aria-label="Selected conversation actions"
      className="bg-popover/90 ring-foreground/10 absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-1.5 rounded-full p-1.5 shadow-lg ring-1 backdrop-blur-xl"
      render={
        <m.div
          animate={{ opacity: 1, y: 0 }}
          exit={
            shouldReduceMotion ? undefined : { opacity: 0, y: enterOffsetY }
          }
          initial={shouldReduceMotion ? false : { opacity: 0, y: enterOffsetY }}
          transition={{
            duration: shouldReduceMotion ? 0 : 0.2,
            ease: "easeOut",
          }}
        />
      }
    >
      <ToolbarGroup
        aria-label="Selection"
        className="flex min-w-0 items-center"
      >
        <span className="text-muted-foreground flex h-8 items-center px-2.5 text-xs whitespace-nowrap tabular-nums">
          {threads.length} selected
        </span>
        <SelectionBarButton
          aria-label="Clear conversation selection"
          className="text-muted-foreground size-8 rounded-full"
          command="mailbox.clearSelection"
          disabled={isPending}
          hint="Clear selection"
          onClick={onClear}
        >
          <XIcon />
        </SelectionBarButton>
      </ToolbarGroup>
      <ToolbarSeparator className="bg-border mx-0.5 h-5" />
      <ToolbarGroup
        aria-label="Message actions"
        className="flex min-w-0 items-center"
      >
        {onArchive === undefined ? null : (
          <SelectionBarButton
            aria-keyshortcuts={getHotkeyAriaLabel("mailbox.archiveThread")}
            aria-label="Archive selected conversations"
            className="size-8 rounded-full"
            command="mailbox.archiveThread"
            disabled={isPending}
            hint="Archive"
            onClick={onArchive}
          >
            <ArchiveIcon />
          </SelectionBarButton>
        )}
        <SelectionBarButton
          aria-label="Mark selected conversations as read"
          className="size-8 rounded-full"
          disabled={isPending}
          hint="Mark as read"
          onClick={() => {
            actions.bulkSetReadState(threads, false);
          }}
        >
          <MailOpenIcon />
        </SelectionBarButton>
        <SelectionBarButton
          aria-label="Mark selected conversations as unread"
          className="size-8 rounded-full"
          disabled={isPending}
          hint="Mark as unread"
          onClick={() => {
            actions.bulkSetReadState(threads, true);
          }}
        >
          <MailIcon />
        </SelectionBarButton>
        {onToggleStar === undefined ? null : (
          <SelectionStarButton
            disabled={isPending}
            isStarred={isStarred}
            onToggle={onToggleStar}
          />
        )}
        <Menu
          controller={labelPicker}
          onOpenChange={(open, details) => {
            if (open && isPending) {
              details.cancel();
              return;
            }
            setIsLabelPickerOpen(open);
          }}
          open={isLabelPickerOpen}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <MenuTrigger
                  disabled={isPending}
                  render={
                    <ToolbarButton
                      aria-keyshortcuts={getHotkeyAriaLabel(
                        "mailbox.manageLabels"
                      )}
                      aria-label="Add or remove labels"
                      className="size-8 rounded-full"
                    />
                  }
                >
                  <TagIcon />
                </MenuTrigger>
              }
            />
            {/* A tooltip around a menu trigger shares its name, so an agent's
                step by that name would match both. */}
            <TooltipContent
              className="flex items-center gap-2"
              data-agent-hidden
            >
              Labels
              <HotkeyHint command="mailbox.manageLabels" />
            </TooltipContent>
          </Tooltip>
          <MenuContent align="center" className="w-60" side="top">
            {labelGroups.every((group) => group.labels.length === 0) ? (
              <MenuItem
                className="text-muted-foreground data-disabled:opacity-100"
                disabled
              >
                {isLoadingLabels ? "Loading labels…" : "No labels"}
              </MenuItem>
            ) : (
              labelGroups.map((group, groupIndex) => (
                <MenuGroup key={group.accountId}>
                  {groupIndex === 0 ? null : <MenuSeparator />}
                  <MenuGroupLabel className="truncate" title={group.accountId}>
                    {group.accountId} · {group.threads.length}
                  </MenuGroupLabel>
                  {group.labels.length === 0 ? (
                    <MenuItem
                      className="text-muted-foreground data-disabled:opacity-100"
                      disabled
                    >
                      No labels for this account
                    </MenuItem>
                  ) : (
                    group.labels.map((label) => {
                      const appliedToAll =
                        label.appliedCount === group.threads.length;
                      const appliedToSome =
                        label.appliedCount > 0 && !appliedToAll;

                      return (
                        <MenuCheckboxItem
                          checked={appliedToAll}
                          disabled={isPending}
                          key={label.id}
                          onCheckedChange={() => {
                            const applied = !appliedToAll;
                            const changedThreads = group.threads.filter(
                              (thread) =>
                                thread.labels.includes(label.name) !== applied
                            );

                            actions.bulkSetLabel(changedThreads, {
                              applied,
                              labelId: label.id,
                              labelName: label.name,
                            });
                          }}
                          value={`${group.accountId}:${label.id}`}
                        >
                          <TagIcon
                            aria-hidden="true"
                            className="text-muted-foreground fill-current"
                            style={
                              label.color === undefined
                                ? undefined
                                : { color: label.color.background }
                            }
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {label.name}
                          </span>
                          {appliedToSome ? (
                            <span className="text-muted-foreground text-[10px]">
                              Some
                            </span>
                          ) : null}
                        </MenuCheckboxItem>
                      );
                    })
                  )}
                </MenuGroup>
              ))
            )}
          </MenuContent>
        </Menu>
      </ToolbarGroup>
      <SelectionRemovalActions
        conversations={conversations}
        disabled={isPending}
        onDeleteForever={
          onDeleteForever === undefined
            ? undefined
            : () => {
                void run(onDeleteForever);
              }
        }
        onReportSpam={onReportSpam}
        onTrash={onTrash}
      />
    </Toolbar>
  );
};

export default ThreadSelectionBar;
