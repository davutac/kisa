import { ArchiveIcon, Trash2Icon } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { RefObject } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSearch,
  createCommandController,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useInstanceValue } from "@/hooks/use-instance-value";
import { getHotkeyDisplay, matchesHotkeyCommand } from "@/hotkeys";
import { getDraftBodyPreview } from "@/mail/mail-draft";
import type { MailDraft } from "@/shared/ipc/mail";

const formatDraftTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });

interface NewMessageStashPickerProps {
  accountsCount: number;
  disabled: boolean;
  drafts: readonly MailDraft[];
  getReturnFocus: () => HTMLElement | null;
  onDiscard: (draft: MailDraft) => void;
  onSelect: (draft: MailDraft) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

export const StashItem = ({
  accountsCount,
  draft,
  onDiscard,
  onSelect,
}: {
  accountsCount: number;
  draft: MailDraft;
  onDiscard: () => void;
  onSelect: () => void;
}) => {
  const bodyPreview = getDraftBodyPreview(draft.body.text);
  const subject = draft.subject.trim() || "No subject";

  return (
    <CommandItem
      className="h-auto min-w-0 py-1.5 pr-1.5"
      keywords={[
        bodyPreview,
        draft.to[0] ?? "No recipient",
        draft.accountId ?? "No account",
      ]}
      label={subject}
      onSelect={onSelect}
      value={draft.id}
    >
      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        <span className="w-full truncate font-medium">{subject}</span>{" "}
        {bodyPreview.length === 0 ? null : (
          <>
            <span className="text-foreground/80 w-full truncate text-xs font-normal">
              {bodyPreview}
            </span>{" "}
          </>
        )}
        <span className="text-muted-foreground w-full truncate text-xs font-normal">
          {draft.to[0] ?? "No recipient"}
          {accountsCount > 1 || draft.accountId === undefined
            ? ` · ${draft.accountId ?? "No account"}`
            : ""}
          {` · ${formatDraftTime(draft.updatedAt)}`}
        </span>
      </span>
      {/* The row itself pops the stash, so the button keeps its click and the
          keys that press it from reaching the row and the list's Enter. It
          stays out of the Tab order: from the search, the discard shortcut
          discards the highlighted stash. */}
      <Button
        aria-label={`Discard stash: ${subject}`}
        className="text-muted-foreground hover:text-destructive focus-visible:text-destructive self-center opacity-0 group-hover/command-item:opacity-100 group-data-highlighted/command-item:opacity-100 focus-visible:opacity-100"
        onClick={(event) => {
          event.stopPropagation();
          onDiscard();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.stopPropagation();
          }
        }}
        size="icon-sm"
        tabIndex={-1}
        title="Discard stash"
        type="button"
        variant="ghost"
      >
        <Trash2Icon />
      </Button>
    </CommandItem>
  );
};

const NewMessageStashPicker = ({
  accountsCount,
  disabled,
  drafts,
  getReturnFocus,
  onDiscard,
  onSelect,
  triggerRef,
}: NewMessageStashPickerProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const command = useInstanceValue(createCommandController);
  const hintId = useId();
  const [discardKeys] = getHotkeyDisplay("composer.discard").bindings;

  return (
    <Popover
      onOpenChange={(nextOpen, details) => {
        // A disabled trigger refuses a press, not an agent's setOpen.
        if (nextOpen && disabled) {
          details.cancel();
          return;
        }
        setIsOpen(nextOpen);
      }}
      open={isOpen}
    >
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            className="h-7"
            ref={triggerRef}
            size="sm"
            type="button"
            variant="secondary"
          />
        }
      >
        <ArchiveIcon data-icon="inline-start" />
        Stash
        <Badge className="ml-2 h-4 px-1 text-xs">{drafts.length}</Badge>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 gap-0 p-0"
        finalFocus={getReturnFocus}
        initialFocus={() => searchInputRef.current}
      >
        <Command controller={command}>
          <CommandSearch>
            <CommandInput
              aria-describedby={hintId}
              aria-label="Search stashes"
              onEscape={() => setIsOpen(false)}
              onKeyDown={(event) => {
                // The composer's own discard key, here for the highlighted
                // stash. Handling it keeps the composer from discarding too.
                if (
                  !matchesHotkeyCommand(event.nativeEvent, "composer.discard")
                ) {
                  return;
                }
                event.preventDefault();
                const highlighted = command.getValue();
                const draft = drafts.find(({ id }) => id === highlighted);
                if (draft !== undefined) {
                  setIsOpen(false);
                  onDiscard(draft);
                }
              }}
              placeholder="Search stashes"
              ref={searchInputRef}
            />
          </CommandSearch>
          <CommandEmpty>No stash answers to that name.</CommandEmpty>
          <CommandList>
            <CommandGroup>
              {drafts.map((draft) => (
                <StashItem
                  accountsCount={accountsCount}
                  draft={draft}
                  key={draft.id}
                  onDiscard={() => {
                    setIsOpen(false);
                    onDiscard(draft);
                  }}
                  onSelect={() => {
                    setIsOpen(false);
                    onSelect(draft);
                  }}
                />
              ))}
            </CommandGroup>
          </CommandList>
          <p
            className="text-muted-foreground bg-card border-border/40 flex items-center gap-3 border-t px-3 py-2 text-[0.625rem]"
            id={hintId}
          >
            <span>↑↓ navigate</span> <span>↵ open</span>{" "}
            <span>{discardKeys} discard</span> <span>esc close</span>
          </p>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default NewMessageStashPicker;
