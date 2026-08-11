import {
  AtSignIcon,
  LaptopIcon,
  PaperclipIcon,
  SearchIcon,
  TagIcon,
  UserIcon,
} from "lucide-react";

import {
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";

import type { MailSearchCompletions } from "./mail-search-completions";

const COMPLETION_ICONS = {
  account: AtSignIcon,
  address: UserIcon,
  attachment: PaperclipIcon,
  label: TagIcon,
  operator: SearchIcon,
  "system-label": LaptopIcon,
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
          {item.trailing === undefined ? null : (
            <CommandShortcut className="max-w-[60%] truncate text-right text-xs tracking-normal">
              {item.trailing}
            </CommandShortcut>
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
