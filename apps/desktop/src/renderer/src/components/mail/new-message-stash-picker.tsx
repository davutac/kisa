import { ArchiveIcon, Trash2Icon } from "lucide-react";
import { useRef, useState } from "react";
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
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
      // A stash row has no checked state, so its hidden check mark would
      // only push the discard button off the row's edge.
      className="h-auto min-w-0 py-1.5 pr-1.5 [&>svg]:hidden"
      onSelect={onSelect}
      value={[
        subject,
        bodyPreview,
        draft.to[0] ?? "No recipient",
        draft.accountId ?? "No account",
        draft.id,
      ].join(" ")}
    >
      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        <span className="w-full truncate font-medium">{subject}</span>
        {bodyPreview.length === 0 ? null : (
          <span className="text-foreground/80 w-full truncate text-xs font-normal">
            {bodyPreview}
          </span>
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
          keys that press it from reaching the row and the list's Enter. */}
      <Button
        aria-label={`Discard stash: ${subject}`}
        className="text-muted-foreground hover:text-destructive focus-visible:text-destructive self-center opacity-0 group-hover/command-item:opacity-100 group-data-selected/command-item:opacity-100 focus-visible:opacity-100"
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

  return (
    <Popover onOpenChange={setIsOpen} open={isOpen}>
      <PopoverTrigger
        render={
          <Button
            className="h-7"
            disabled={disabled}
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
        initialFocus={searchInputRef}
      >
        <Command key={isOpen ? "open" : "closed"}>
          <CommandInput placeholder="Search stashes" ref={searchInputRef} />
          <CommandList>
            <CommandEmpty>No stash answers to that name.</CommandEmpty>
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
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default NewMessageStashPicker;
