import { PaperclipIcon, SearchIcon, UserIcon } from "lucide-react";

import {
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";

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
          <span className="truncate font-medium">{item.label}</span>
          {item.sublabel === undefined ? null : (
            <span className="text-muted-foreground truncate">
              {item.sublabel}
            </span>
          )}
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
