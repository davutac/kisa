import {
  MailIcon,
  MailOpenIcon,
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
  onClear: () => void;
  /** Confirms first, so the bar waits for it. */
  onDeleteForever?: () => Promise<void>;
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

const ThreadSelectionBar = ({
  actions,
  onClear,
  onDeleteForever,
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
  const isDeleteForever = onDeleteForever !== undefined;
  const hasDestructiveAction = isDeleteForever || onTrash !== undefined;

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

  return (
    <Toolbar
      aria-label="Selected conversation actions"
      className="bg-popover/90 ring-foreground/10 absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-1.5 rounded-full p-1.5 shadow-lg ring-1 backdrop-blur-xl"
      render={
        <m.div
          animate={{ opacity: 1, y: 0 }}
          exit={shouldReduceMotion ? undefined : { opacity: 0, y: 20 }}
          initial={shouldReduceMotion ? false : { opacity: 0, y: 20 }}
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
      {hasDestructiveAction ? (
        <>
          <ToolbarSeparator className="bg-border mx-0.5 h-5" />
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
            disabled={isPending}
            hint={isDeleteForever ? "Delete forever" : "Move to trash"}
            onClick={() => {
              if (onDeleteForever === undefined) {
                onTrash?.();
              } else {
                void run(onDeleteForever);
              }
            }}
          >
            <Trash2Icon />
          </SelectionBarButton>
        </>
      ) : null}
    </Toolbar>
  );
};

export default ThreadSelectionBar;
