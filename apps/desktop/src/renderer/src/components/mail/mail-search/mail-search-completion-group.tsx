import { PaperclipIcon, SearchIcon, UserIcon } from "lucide-react";

import {
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

import type { MailSearchCompletions } from "./mail-search-completions";

const COMPLETION_ICONS = {
  address: UserIcon,
  attachment: PaperclipIcon,
  operator: SearchIcon,
} as const;

const MailSearchCompletionGroup = ({
  empty,
  heading,
  items,
}: MailSearchCompletions) => (
  <CommandGroup heading={heading}>
    {items.map((item) => {
      const Icon = COMPLETION_ICONS[item.icon];
      const handleSelect = (): void => item.onSelect();
      return (
        <CommandItem
          key={item.value}
          onSelect={handleSelect}
          value={item.value}
        >
          <Icon className="opacity-60" />
          {/* The label is what gets chosen, so the sublabel gives way first.
              A long sender name stops at 60% so its address still shows. */}
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span
              className={cn(
                "shrink-0 truncate font-medium",
                item.sublabel === undefined ? "max-w-full" : "max-w-[60%]"
              )}
            >
              {item.label}
            </span>
            {item.sublabel === undefined ? null : (
              <span className="text-muted-foreground min-w-0 truncate">
                {item.sublabel}
              </span>
            )}
          </span>
          {item.shortcut === undefined ? null : (
            <CommandShortcut>{item.shortcut}</CommandShortcut>
          )}
        </CommandItem>
      );
    })}
    {items.length === 0 && empty !== undefined ? (
      <p className="text-muted-foreground px-2.5 py-3">{empty}</p>
    ) : null}
  </CommandGroup>
);

export default MailSearchCompletionGroup;
