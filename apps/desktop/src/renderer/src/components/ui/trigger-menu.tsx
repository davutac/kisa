import {
  TriggerMenuContent as TriggerMenuContentPrimitive,
  TriggerMenuEmpty as TriggerMenuEmptyPrimitive,
  TriggerMenuItem as TriggerMenuItemPrimitive,
  TriggerMenuStatus as TriggerMenuStatusPrimitive,
} from "@ui-sdk/react/trigger-menu";

import { cn } from "@/lib/utils";

export {
  createTriggerMenuController,
  TriggerMenu,
  TriggerMenuList,
} from "@ui-sdk/react/trigger-menu";

type ClassNameProps<Props> = Omit<Props, "className"> & { className?: string };

const TriggerMenuContent = ({
  className,
  sideOffset = 4,
  ...props
}: ClassNameProps<
  React.ComponentProps<typeof TriggerMenuContentPrimitive>
>) => (
  <TriggerMenuContentPrimitive
    sideOffset={sideOffset}
    className={cn(
      "bg-popover text-popover-foreground ring-foreground/10 max-h-40 min-w-56 origin-(--transform-origin) overflow-y-auto overscroll-contain rounded-lg p-1 shadow-lg ring-1 transition-[opacity,scale] duration-100 outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
      className
    )}
    {...props}
  />
);

const TriggerMenuItem = <T = string,>({
  className,
  ...props
}: ClassNameProps<
  React.ComponentProps<typeof TriggerMenuItemPrimitive<T>>
>) => (
  <TriggerMenuItemPrimitive
    className={cn(
      "data-highlighted:bg-foreground/10 flex w-full cursor-default flex-col items-start rounded-md px-2 py-1.5 text-left outline-none select-none data-disabled:opacity-50",
      className
    )}
    {...props}
  />
);

const TriggerMenuEmpty = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof TriggerMenuEmptyPrimitive>>) => (
  <TriggerMenuEmptyPrimitive
    className={cn(
      "text-muted-foreground px-2 py-1.5 text-xs empty:hidden",
      className
    )}
    {...props}
  />
);

// The count and keys are for screen readers; the open list already shows them.
const TriggerMenuStatus = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof TriggerMenuStatusPrimitive>>) => (
  <TriggerMenuStatusPrimitive className={cn("sr-only", className)} {...props} />
);

export {
  TriggerMenuContent,
  TriggerMenuEmpty,
  TriggerMenuItem,
  TriggerMenuStatus,
};
