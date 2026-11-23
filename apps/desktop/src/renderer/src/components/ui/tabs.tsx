import {
  Tabs as TabsPrimitive,
  TabsList as TabsListPrimitive,
  TabsPanel as TabsPanelPrimitive,
  TabsTab as TabsTabPrimitive,
} from "@ui-sdk/react/tabs";

import { cn } from "@/lib/utils";

type ClassNameProps<Props> = Omit<Props, "className"> & { className?: string };

const Tabs = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof TabsPrimitive>>) => (
  <TabsPrimitive
    className={cn(
      "flex gap-2 data-[orientation=horizontal]:flex-col",
      className
    )}
    {...props}
  />
);

const TabsList = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof TabsListPrimitive>>) => (
  <TabsListPrimitive
    className={cn(
      "flex gap-0.5 data-[orientation=vertical]:flex-col",
      className
    )}
    {...props}
  />
);

const TabsTab = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof TabsTabPrimitive>>) => (
  <TabsTabPrimitive
    className={cn(
      "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/30 data-selected:bg-muted data-selected:text-foreground dark:hover:bg-muted/50 dark:data-selected:bg-muted inline-flex h-8 min-w-0 items-center gap-2.5 rounded-md px-2 text-[13px] whitespace-nowrap outline-none select-none focus-visible:ring-2 data-disabled:opacity-50 data-selected:font-medium data-[orientation=vertical]:w-full data-[orientation=vertical]:justify-start [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
      className
    )}
    {...props}
  />
);

const TabsPanel = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof TabsPanelPrimitive>>) => (
  <TabsPanelPrimitive className={cn("outline-none", className)} {...props} />
);

export { Tabs, TabsList, TabsPanel, TabsTab };
