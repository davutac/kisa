import {
  Popover as PopoverPrimitive,
  PopoverContent as PopoverContentPrimitive,
  PopoverDescription as PopoverDescriptionPrimitive,
  PopoverTitle as PopoverTitlePrimitive,
} from "@ui-sdk/react/popover";

import { cn } from "@/lib/utils";

export { PopoverTrigger } from "@ui-sdk/react/popover";

type ClassNameProps<Props> = Omit<Props, "className"> & { className?: string };

// Switching to another window, like copying a link from a browser, shouldn't
// discard what someone typed into a popover; Base UI kept them open too.
const Popover = ({
  onOpenChange,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive>) => (
  <PopoverPrimitive
    onOpenChange={(open, details) => {
      if (!open && details.reason === "window-blur") {
        details.cancel();

        return;
      }

      onOpenChange?.(open, details);
    }}
    {...props}
  />
);

const PopoverContent = ({
  className,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  ...props
}: ClassNameProps<React.ComponentProps<typeof PopoverContentPrimitive>>) => (
  <PopoverContentPrimitive
    align={align}
    alignOffset={alignOffset}
    side={side}
    sideOffset={sideOffset}
    className={cn(
      "bg-popover text-popover-foreground ring-foreground/10 flex w-72 origin-(--transform-origin) flex-col gap-4 rounded-lg p-2.5 text-xs shadow-md ring-1 outline-hidden transition-[opacity,scale] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
      className
    )}
    {...props}
  />
);

const PopoverTitle = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof PopoverTitlePrimitive>>) => (
  <PopoverTitlePrimitive
    className={cn("text-sm font-medium", className)}
    {...props}
  />
);

const PopoverDescription = ({
  className,
  ...props
}: ClassNameProps<
  React.ComponentProps<typeof PopoverDescriptionPrimitive>
>) => (
  <PopoverDescriptionPrimitive
    className={cn("text-muted-foreground", className)}
    {...props}
  />
);

export { Popover, PopoverContent, PopoverDescription, PopoverTitle };
