import {
  MailOpenIcon,
  PaperclipIcon,
  SendIcon,
  TagIcon,
  TypeIcon,
  UserRoundIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { SearchFilterField } from "@/mail/search-query";

import type { MailSearchCompletions } from "./mail-search-completions";

const FIELD_ICONS = {
  from: UserRoundIcon,
  has: PaperclipIcon,
  is: MailOpenIcon,
  label: TagIcon,
  subject: TypeIcon,
  to: SendIcon,
} satisfies Record<SearchFilterField, LucideIcon>;

export const MAIL_SEARCH_GROUP_CLASS_NAME = "p-0";
export const MAIL_SEARCH_GROUP_LABEL_CLASS_NAME =
  "px-3 pt-3 pb-1.5 text-xs font-normal";
export const MAIL_SEARCH_ITEM_CLASS_NAME = "min-h-9 gap-3 rounded-lg px-3 py-2";

export const MailSearchItemIcon = ({
  className,
  icon: Icon,
}: {
  className?: string;
  icon: LucideIcon;
}) => (
  <Icon
    aria-hidden="true"
    className={cn(
      "text-muted-foreground group-data-highlighted/command-item:text-foreground size-4 shrink-0",
      className
    )}
  />
);

const MailSearchCompletionGroup = ({ heading, items }: MailSearchCompletions) =>
  items.length === 0 ? null : (
    <CommandGroup className={MAIL_SEARCH_GROUP_CLASS_NAME}>
      <CommandGroupLabel className={MAIL_SEARCH_GROUP_LABEL_CLASS_NAME}>
        {heading}
      </CommandGroupLabel>
      {items.map((item) => {
        const handleSelect = (): void => item.onSelect();
        return (
          <CommandItem
            className={MAIL_SEARCH_ITEM_CLASS_NAME}
            key={item.value}
            onSelect={handleSelect}
            value={item.value}
          >
            <MailSearchItemIcon icon={FIELD_ICONS[item.field]} />
            {/* The label is what gets chosen, so the sublabel gives way first.
                A long sender name stops at 60% so its address still shows. */}
            <span className="flex min-w-0 flex-1 items-baseline gap-3">
              <span
                className={cn(
                  "text-foreground shrink-0 truncate",
                  item.sublabel === undefined ? "max-w-full" : "max-w-[60%]"
                )}
              >
                {item.label}
              </span>
              {item.sublabel === undefined ? null : (
                <>
                  {" "}
                  <span className="text-muted-foreground ml-auto min-w-0 truncate">
                    {item.sublabel}
                  </span>
                </>
              )}
            </span>
            {item.shortcut === undefined ? null : (
              <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                {item.shortcut}
              </span>
            )}
          </CommandItem>
        );
      })}
    </CommandGroup>
  );

// ui-sdk hides a group with no commands, and a listbox holds only options, so
// a filter's hint while it has no completions sits above the list.
export const MailSearchCompletionHint = ({
  empty,
  heading,
  items,
}: MailSearchCompletions) =>
  items.length > 0 || empty === undefined ? null : (
    <div className="px-1">
      <p
        className={cn(
          "text-muted-foreground",
          MAIL_SEARCH_GROUP_LABEL_CLASS_NAME
        )}
      >
        {heading}
      </p>
      <p className="text-muted-foreground px-3 py-2.5 text-sm">{empty}</p>
    </div>
  );

export default MailSearchCompletionGroup;
