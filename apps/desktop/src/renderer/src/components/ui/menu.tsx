import {
  MenuCheckboxItem as MenuCheckboxItemPrimitive,
  MenuContent as MenuContentPrimitive,
  MenuGroupLabel as MenuGroupLabelPrimitive,
  MenuItem as MenuItemPrimitive,
  MenuItemIndicator,
  MenuRadioItem as MenuRadioItemPrimitive,
  MenuSeparator as MenuSeparatorPrimitive,
  MenuSubContent as MenuSubContentPrimitive,
  MenuSubTrigger as MenuSubTriggerPrimitive,
} from "@ui-sdk/react/menu";
import { CheckIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export {
  createMenuController,
  Menu,
  MenuGroup,
  MenuRadioGroup,
  MenuSub,
  MenuTrigger,
} from "@ui-sdk/react/menu";
export type { MenuController } from "@ui-sdk/react/menu";

type ClassNameProps<Props> = Omit<Props, "className"> & { className?: string };

const menuContentClassName =
  "max-h-(--available-height) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover/70 p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 backdrop-blur-2xl backdrop-saturate-150 outline-none";

const menuItemClassName =
  "relative flex min-h-7 cursor-default items-center gap-2 rounded-md text-xs/relaxed outline-hidden select-none data-highlighted:bg-foreground/10 data-highlighted:text-accent-foreground data-highlighted:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5";

const MenuContent = ({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof MenuContentPrimitive>>) => (
  <MenuContentPrimitive
    align={align}
    alignOffset={alignOffset}
    side={side}
    sideOffset={sideOffset}
    className={cn(menuContentClassName, "w-(--anchor-width)", className)}
    {...props}
  />
);

const MenuGroupLabel = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof MenuGroupLabelPrimitive>>) => (
  <MenuGroupLabelPrimitive
    className={cn("text-muted-foreground px-2 py-1.5 text-xs", className)}
    {...props}
  />
);

const MenuItem = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof MenuItemPrimitive>>) => (
  <MenuItemPrimitive
    className={cn(menuItemClassName, "px-2 py-1", className)}
    {...props}
  />
);

const MenuCheckboxItem = ({
  className,
  children,
  ...props
}: Omit<
  ClassNameProps<React.ComponentProps<typeof MenuCheckboxItemPrimitive>>,
  "children"
> & {
  children?: React.ReactNode;
}) => (
  <MenuCheckboxItemPrimitive
    className={cn(menuItemClassName, "py-1.5 pr-8 pl-2", className)}
    {...props}
  >
    <MenuItemIndicator className="pointer-events-none absolute right-2 flex items-center justify-center">
      <CheckIcon aria-hidden="true" />
    </MenuItemIndicator>
    {children}
  </MenuCheckboxItemPrimitive>
);

const MenuRadioItem = ({
  className,
  children,
  ...props
}: Omit<
  ClassNameProps<React.ComponentProps<typeof MenuRadioItemPrimitive>>,
  "children"
> & {
  children?: React.ReactNode;
}) => (
  <MenuRadioItemPrimitive
    className={cn(menuItemClassName, "py-1.5 pr-8 pl-2", className)}
    {...props}
  >
    <MenuItemIndicator className="pointer-events-none absolute right-2 flex items-center justify-center">
      <CheckIcon aria-hidden="true" />
    </MenuItemIndicator>
    {children}
  </MenuRadioItemPrimitive>
);

const MenuSeparator = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof MenuSeparatorPrimitive>>) => (
  <MenuSeparatorPrimitive
    className={cn("bg-foreground/5 -mx-1 my-1 h-px", className)}
    {...props}
  />
);

const MenuSubTrigger = ({
  className,
  children,
  ...props
}: Omit<
  ClassNameProps<React.ComponentProps<typeof MenuSubTriggerPrimitive>>,
  "children"
> & {
  children?: React.ReactNode;
}) => (
  <MenuSubTriggerPrimitive
    className={cn(
      menuItemClassName,
      "data-open:bg-foreground/10 px-2 py-1",
      className
    )}
    {...props}
  >
    {children}
    <ChevronRightIcon aria-hidden="true" className="ml-auto rtl:rotate-180" />
  </MenuSubTriggerPrimitive>
);

const MenuSubContent = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof MenuSubContentPrimitive>>) => (
  <MenuSubContentPrimitive
    className={cn(menuContentClassName, className)}
    {...props}
  />
);

export {
  MenuCheckboxItem,
  MenuContent,
  MenuGroupLabel,
  MenuItem,
  MenuRadioItem,
  MenuSeparator,
  MenuSubContent,
  MenuSubTrigger,
};
