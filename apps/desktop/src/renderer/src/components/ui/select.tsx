import {
  SelectContent as SelectContentPrimitive,
  SelectItem as SelectItemPrimitive,
  SelectItemIndicator,
  SelectTrigger as SelectTriggerPrimitive,
  SelectValue as SelectValuePrimitive,
} from "@ui-sdk/react/select";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export { Select } from "@ui-sdk/react/select";

type ClassNameProps<Props> = Omit<Props, "className" | "children"> & {
  className?: string;
  children?: React.ReactNode;
};

const SelectTrigger = ({
  className,
  children,
  ...props
}: ClassNameProps<React.ComponentProps<typeof SelectTriggerPrimitive>>) => (
  <SelectTriggerPrimitive
    className={cn(
      "bg-input/20 focus-visible:ring-ring/30 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:ring-destructive/40 flex h-7 w-fit min-w-0 items-center justify-between gap-1.5 rounded-md border border-transparent py-0.5 pr-1.5 pl-2 text-left text-xs/relaxed transition-colors outline-none select-none focus-visible:ring-2 aria-invalid:ring-2 data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50",
      className
    )}
    {...props}
  >
    {children}
    <ChevronDownIcon
      aria-hidden="true"
      className="text-muted-foreground size-3.5 shrink-0"
    />
  </SelectTriggerPrimitive>
);

const SelectValue = ({
  className,
  ...props
}: Omit<React.ComponentProps<typeof SelectValuePrimitive>, "className"> & {
  className?: string;
}) => (
  <SelectValuePrimitive
    className={cn(
      "data-placeholder:text-muted-foreground min-w-0 truncate",
      className
    )}
    {...props}
  />
);

// Like the native select it replaces, the list opens over the trigger with
// the chosen item on top of it.
const SelectContent = ({
  className,
  alignItemWithTrigger = true,
  ...props
}: ClassNameProps<React.ComponentProps<typeof SelectContentPrimitive>>) => (
  <SelectContentPrimitive
    alignItemWithTrigger={alignItemWithTrigger}
    className={cn(
      "bg-popover text-popover-foreground ring-foreground/10 max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-lg p-1 text-xs shadow-md ring-1 transition-[opacity,scale] duration-100 outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
      className
    )}
    {...props}
  />
);

const SelectItem = ({
  className,
  children,
  ...props
}: ClassNameProps<Parameters<typeof SelectItemPrimitive<string>>[0]>) => (
  <SelectItemPrimitive
    className={cn(
      "data-highlighted:bg-accent data-highlighted:text-accent-foreground relative flex min-h-7 cursor-default items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-xs outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
      className
    )}
    {...props}
  >
    {children}
    <SelectItemIndicator className="pointer-events-none absolute right-2 flex items-center justify-center">
      <CheckIcon aria-hidden="true" />
    </SelectItemIndicator>
  </SelectItemPrimitive>
);

export { SelectContent, SelectItem, SelectTrigger, SelectValue };
