import {
  ScrollArea as ScrollAreaPrimitive,
  ScrollAreaScrollbar as ScrollAreaScrollbarPrimitive,
  ScrollAreaThumb as ScrollAreaThumbPrimitive,
} from "@ui-sdk/react/scroll-area";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

// Like macOS overlay scrollbars: the bar floats over the content instead of
// taking a lane beside it, and shows while scrolling. `isolate` keeps its
// z-index from rising above overlays outside the area.
const ScrollArea = ({
  className,
  type = "scroll",
  ...props
}: Omit<ComponentProps<typeof ScrollAreaPrimitive>, "className"> & {
  className?: string;
}) => (
  <ScrollAreaPrimitive
    className={cn("relative isolate", className)}
    type={type}
    {...props}
  />
);

const ScrollAreaScrollbar = ({
  className,
  ...props
}: Omit<ComponentProps<typeof ScrollAreaScrollbarPrimitive>, "className"> & {
  className?: string;
}) => (
  <ScrollAreaScrollbarPrimitive
    className={cn(
      "z-20 flex w-2.5 p-0.5 opacity-0 transition-opacity duration-200 data-visible:opacity-100 data-visible:duration-100",
      className
    )}
    {...props}
  />
);

const ScrollAreaThumb = ({
  className,
  ...props
}: Omit<ComponentProps<typeof ScrollAreaThumbPrimitive>, "className"> & {
  className?: string;
}) => (
  <ScrollAreaThumbPrimitive
    className={cn(
      "bg-foreground/25 hover:bg-foreground/40 data-dragging:bg-foreground/40 w-full rounded-full transition-colors",
      className
    )}
    {...props}
  />
);

export { ScrollArea, ScrollAreaScrollbar, ScrollAreaThumb };

export {
  ScrollAreaContent,
  ScrollAreaViewport,
} from "@ui-sdk/react/scroll-area";
