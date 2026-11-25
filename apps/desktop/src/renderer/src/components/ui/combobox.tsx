import {
  ComboboxChip as ComboboxChipPrimitive,
  ComboboxChipRemove as ComboboxChipRemovePrimitive,
  ComboboxChips as ComboboxChipsPrimitive,
  ComboboxContent as ComboboxContentPrimitive,
  ComboboxInput as ComboboxInputPrimitive,
  ComboboxItem as ComboboxItemPrimitive,
  ComboboxList as ComboboxListPrimitive,
} from "@ui-sdk/react/combobox";

import { cn } from "@/lib/utils";

export {
  Combobox,
  ComboboxLabel,
  ComboboxValue,
  createComboboxController,
} from "@ui-sdk/react/combobox";

type ClassNameProps<Props> = Omit<Props, "className"> & { className?: string };

const ComboboxInput = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof ComboboxInputPrimitive>>) => (
  <ComboboxInputPrimitive
    className={cn(
      "placeholder:text-muted-foreground aria-invalid:text-destructive h-6 w-full min-w-0 bg-transparent text-sm outline-none data-disabled:cursor-not-allowed data-disabled:opacity-50 md:text-sm",
      className
    )}
    {...props}
  />
);

const ComboboxChips = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof ComboboxChipsPrimitive>>) => (
  <ComboboxChipsPrimitive
    className={cn(
      "flex min-w-0 flex-1 flex-wrap items-center gap-1",
      className
    )}
    {...props}
  />
);

const ComboboxChip = <T = string,>({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof ComboboxChipPrimitive<T>>>) => (
  <ComboboxChipPrimitive
    className={cn(
      "bg-secondary text-secondary-foreground focus-visible:ring-ring/50 inline-flex h-6 max-w-64 shrink-0 items-center gap-1 rounded-full pr-1.5 pl-2.5 text-xs font-medium outline-none focus-visible:ring-2",
      className
    )}
    {...props}
  />
);

const ComboboxChipRemove = ({
  className,
  ...props
}: ClassNameProps<
  React.ComponentProps<typeof ComboboxChipRemovePrimitive>
>) => (
  <ComboboxChipRemovePrimitive
    className={cn(
      "hover:bg-foreground/10 focus-visible:ring-ring/50 grid size-3.5 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:size-2.5",
      className
    )}
    {...props}
  />
);

const ComboboxContent = ({
  align = "start",
  side = "bottom",
  sideOffset = 4,
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof ComboboxContentPrimitive>>) => (
  <ComboboxContentPrimitive
    align={align}
    side={side}
    sideOffset={sideOffset}
    className={cn(
      "bg-popover/70 text-popover-foreground ring-foreground/10 max-h-(--available-height) min-w-64 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg p-1 shadow-md ring-1 backdrop-blur-2xl backdrop-saturate-150 transition-[opacity,scale] duration-100 outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
      className
    )}
    {...props}
  />
);

const ComboboxList = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof ComboboxListPrimitive>>) => (
  <ComboboxListPrimitive
    className={cn("flex flex-col", className)}
    {...props}
  />
);

const ComboboxItem = <T = string,>({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof ComboboxItemPrimitive<T>>>) => (
  <ComboboxItemPrimitive
    className={cn(
      "data-highlighted:bg-foreground/10 data-highlighted:text-accent-foreground relative flex min-h-7 cursor-default items-center gap-2 rounded-md px-2 py-1 text-xs/relaxed outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50",
      className
    )}
    {...props}
  />
);

export {
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxChips,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
};
