import { renderElement } from "@ui-sdk/react/primitive";
import type { RenderProp } from "@ui-sdk/react/primitive";

import { cn } from "@/lib/utils";

type KbdProps = React.ComponentProps<"kbd"> & { render?: RenderProp };

const Kbd = ({ className, render, ...props }: KbdProps) =>
  renderElement(
    "kbd",
    {
      "data-slot": "kbd",
      className: cn(
        "bg-muted text-muted-foreground in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-lg px-1 font-sans text-[0.625rem] font-medium select-none [&_svg:not([class*='size-'])]:size-3",
        className
      ),
      ...props,
    },
    render
  );

const KbdGroup = ({ className, render, ...props }: KbdProps) =>
  renderElement(
    "kbd",
    {
      "data-slot": "kbd-group",
      className: cn("inline-flex items-center gap-0.5", className),
      ...props,
    },
    render
  );

export { Kbd, KbdGroup };
