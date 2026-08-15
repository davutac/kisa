import {
  MailIcon,
  MailOpenIcon,
  TagIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { m, useReducedMotionConfig } from "motion/react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getHotkeyAriaLabel, getHotkeyDisplay, useAppCommand } from "@/hotkeys";
import { getBulkLabelGroups } from "@/mail/bulk-thread-selection";
import type { ThreadActions } from "@/mail/use-thread-actions";
import type { GmailMailbox, GmailThreadSummary } from "@/shared/ipc/mail";
import { useGmailLabelCatalogs } from "@/state/gmail-labels";

interface ThreadSelectionBarProps {
  actions: ThreadActions;
  mailbox: GmailMailbox;
  onClear: () => void;
  onTrash: () => Promise<void>;
  threads: readonly GmailThreadSummary[];
}

const ThreadSelectionBar = ({
  actions,
  mailbox,
  onClear,
  onTrash,
  threads,
}: ThreadSelectionBarProps) => {
  const shouldReduceMotion = useReducedMotionConfig();
  const catalogs = useGmailLabelCatalogs();
  const [isLabelPickerOpen, setIsLabelPickerOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const labelGroups = useMemo(
    () => getBulkLabelGroups(threads, catalogs),
    [catalogs, threads]
  );
  const isLoadingLabels = threads.some(
    (thread) => !catalogs.has(thread.accountId)
  );
  const labelPickerHotkey = getHotkeyDisplay("mailbox.manageLabels");

  useAppCommand(
    "mailbox.manageLabels",
    () => {
      setIsLabelPickerOpen(true);
    },
    { enabled: !isLabelPickerOpen && !isPending }
  );

  const run = async (action: () => Promise<void>) => {
    setIsPending(true);
    try {
      await action();
    } finally {
      setIsPending(false);
    }
  };

  return (
    <m.div
      animate={{ opacity: 1, y: 0 }}
      aria-label="Selected conversation actions"
      className="bg-popover/90 ring-foreground/10 fixed bottom-4 left-1/2 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-1.5 rounded-full p-1.5 shadow-lg ring-1 backdrop-blur-xl"
      exit={shouldReduceMotion ? undefined : { opacity: 0, y: 20 }}
      initial={shouldReduceMotion ? false : { opacity: 0, y: 20 }}
      role="toolbar"
      transition={{ duration: shouldReduceMotion ? 0 : 0.2, ease: "easeOut" }}
    >
      <fieldset
        aria-label="Selection"
        className="flex min-w-0 items-center border-0"
      >
        <span className="text-muted-foreground flex h-8 min-w-8 items-center justify-center px-2 text-xs tabular-nums">
          {threads.length}
        </span>
        <Button
          aria-label="Clear conversation selection"
          className="text-muted-foreground size-8 rounded-full"
          disabled={isPending}
          onClick={onClear}
          size="icon"
          title="Clear selection"
          type="button"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </fieldset>
      <span aria-hidden="true" className="bg-border mx-0.5 h-5 w-px" />
      <fieldset
        aria-label="Message actions"
        className="flex min-w-0 items-center border-0"
      >
        <Button
          aria-label="Mark selected conversations as read"
          className="size-8 rounded-full"
          disabled={isPending}
          onClick={() => {
            void run(() => actions.bulkSetReadState(threads, false));
          }}
          size="icon"
          title="Mark as read"
          type="button"
          variant="ghost"
        >
          <MailOpenIcon />
        </Button>
        <Button
          aria-label="Mark selected conversations as unread"
          className="size-8 rounded-full"
          disabled={isPending}
          onClick={() => {
            void run(() => actions.bulkSetReadState(threads, true));
          }}
          size="icon"
          title="Mark as unread"
          type="button"
          variant="ghost"
        >
          <MailIcon />
        </Button>
        <DropdownMenu
          onOpenChange={setIsLabelPickerOpen}
          open={isLabelPickerOpen}
        >
          <DropdownMenuTrigger
            render={
              <Button
                aria-keyshortcuts={getHotkeyAriaLabel("mailbox.manageLabels")}
                aria-label="Add or remove labels"
                className="size-8 rounded-full"
                disabled={isPending}
                size="icon"
                title={`Labels (${labelPickerHotkey.bindings.join(", ")})`}
                type="button"
                variant="ghost"
              >
                <TagIcon />
              </Button>
            }
          />
          <DropdownMenuContent align="center" className="w-60" side="top">
            {labelGroups.every((group) => group.labels.length === 0) ? (
              <DropdownMenuLabel>
                {isLoadingLabels ? "Loading labels…" : "No labels"}
              </DropdownMenuLabel>
            ) : (
              labelGroups.map((group, groupIndex) => (
                <DropdownMenuGroup key={group.accountId}>
                  {groupIndex === 0 ? null : <DropdownMenuSeparator />}
                  <DropdownMenuLabel
                    className="truncate"
                    title={group.accountId}
                  >
                    {group.accountId} · {group.threads.length}
                  </DropdownMenuLabel>
                  {group.labels.length === 0 ? (
                    <DropdownMenuLabel>
                      No labels for this account
                    </DropdownMenuLabel>
                  ) : (
                    group.labels.map((label) => {
                      const appliedToAll =
                        label.appliedCount === group.threads.length;
                      const appliedToSome =
                        label.appliedCount > 0 && !appliedToAll;

                      return (
                        <DropdownMenuCheckboxItem
                          checked={appliedToAll}
                          closeOnClick={false}
                          disabled={isPending}
                          key={label.id}
                          onCheckedChange={() => {
                            const applied = !appliedToAll;

                            void run(() =>
                              actions.bulkSetLabel(group.threads, {
                                applied,
                                labelId: label.id,
                              })
                            );
                          }}
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
                        </DropdownMenuCheckboxItem>
                      );
                    })
                  )}
                </DropdownMenuGroup>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </fieldset>
      <span aria-hidden="true" className="bg-border mx-0.5 h-5 w-px" />
      <Button
        aria-label={
          mailbox === "spam"
            ? "Permanently delete selected conversations"
            : "Move selected conversations to trash"
        }
        className="text-destructive hover:text-destructive focus-visible:text-destructive size-8 rounded-full"
        disabled={isPending}
        onClick={() => {
          void run(onTrash);
        }}
        size="icon"
        title={mailbox === "spam" ? "Delete forever" : "Move to trash"}
        type="button"
        variant="ghost"
      >
        <Trash2Icon />
      </Button>
    </m.div>
  );
};

export default ThreadSelectionBar;
