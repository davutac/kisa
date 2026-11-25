import {
  createTooltipController,
  Tooltip as TooltipPrimitive,
  TooltipArrow,
  TooltipContent as TooltipContentPrimitive,
} from "@ui-sdk/react/tooltip";
import { createContext, use, useEffect, useState } from "react";
import { flushSync } from "react-dom";

import { useInstanceValue } from "@/hooks/use-instance-value";
import { cn } from "@/lib/utils";

export { TooltipTrigger } from "@ui-sdk/react/tooltip";

const ClosesAtOnceContext = createContext(false);

// Open without ui-sdk's 600 ms delay, and close before an Escape arrives, so
// a tooltip under a resting pointer doesn't swallow the app's Escape. A press
// closes it at once: the popup or change the press opens animates in at the
// same spot, and the two shouldn't overlap.
const Tooltip = ({
  controller,
  delay = 0,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive>) => {
  const ownController = useInstanceValue(createTooltipController);
  const tooltip = controller ?? ownController;
  const [isOpen, setIsOpen] = useState(false);
  const [closesAtOnce, setClosesAtOnce] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const releaseEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        tooltip.close();
      }
    };

    document.addEventListener("keydown", releaseEscape, true);

    return () => document.removeEventListener("keydown", releaseEscape, true);
  }, [isOpen, tooltip]);

  return (
    <ClosesAtOnceContext value={closesAtOnce}>
      <TooltipPrimitive
        controller={tooltip}
        delay={delay}
        onOpenChange={(open, details) => {
          onOpenChange?.(open, details);

          if (open) {
            setClosesAtOnce(false);
          } else if (details.reason === "trigger-press") {
            // Committed before ui-sdk starts the exit, which then has no
            // transition to wait for.
            flushSync(() => {
              setClosesAtOnce(true);
            });
          }

          setIsOpen(open);
        }}
        {...props}
      />
    </ClosesAtOnceContext>
  );
};

// ui-sdk renders the content in place and shows it as a popover in the top
// layer. A class that sets `display` overrides the browser's own rule that
// hides a closed popover, and `hidden` is written only a render after the
// popover closes. Without `not-open:hidden` the content is laid out in between
// as a fixed box against any transformed ancestor, far from its trigger, and
// lengthens whatever scrolls around it.
const TooltipContent = ({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: Omit<
  React.ComponentProps<typeof TooltipContentPrimitive>,
  "children" | "className"
> & {
  children?: React.ReactNode;
  className?: string;
}) => (
  <TooltipContentPrimitive
    align={align}
    alignOffset={alignOffset}
    data-closes-at-once={use(ClosesAtOnceContext) ? "" : undefined}
    side={side}
    sideOffset={sideOffset}
    className={cn(
      "bg-foreground text-background inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 overflow-visible rounded-md px-3 py-1.5 text-xs transition-[opacity,scale] duration-100 not-open:hidden has-data-[slot=kbd]:pr-1.5 data-closes-at-once:transition-none data-ending-style:scale-95 data-ending-style:opacity-0 data-instant:transition-none data-starting-style:scale-95 data-starting-style:opacity-0 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm",
      className
    )}
    {...props}
  >
    {children}
    <TooltipArrow className="bg-foreground size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] data-[side=bottom]:top-1 data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5" />
  </TooltipContentPrimitive>
);

export { Tooltip, TooltipContent };
