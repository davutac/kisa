import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastRegion,
  ToastTitle,
} from "@ui-sdk/react/toast";
import type { ToastType } from "@ui-sdk/react/toast";
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export { toast } from "@ui-sdk/react/toast";

const TOAST_ICONS = {
  default: undefined,
  error: OctagonXIcon,
  info: InfoIcon,
  loading: Loader2Icon,
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
} satisfies Record<ToastType, LucideIcon | undefined>;

// The region is a bare popover, so its user-agent box is reset and placed at
// the bottom right, where Sonner put it.
const regionClassName =
  "fixed inset-auto right-6 bottom-6 m-0 h-(--toast-front-height) w-89 max-w-[calc(100vw-3rem)] overflow-visible border-0 bg-transparent p-0 text-popover-foreground data-expanded:h-[calc(var(--toast-stack-height)+(var(--toast-count)-1)*14px)]";

// Collapsed, older toasts peek 14px above the newest; expanded, each moves up
// by the heights in front of it. ui-sdk measures both into the variables.
const toastClassName =
  "group/toast absolute inset-x-0 bottom-0 z-[calc(100-var(--toast-index))] flex h-(--toast-height) items-center gap-2 overflow-hidden rounded-lg border bg-popover p-4 text-[13px] text-popover-foreground shadow-lg outline-none select-none [--y:calc(0px-var(--toast-index)*14px)] [scale:calc(1-var(--toast-index)*0.05)] [translate:var(--toast-swipe-x,0px)_calc(var(--y)+var(--toast-swipe-y,0px))] transition-[translate,scale,opacity,height] duration-400 ease-out focus-visible:ring-2 focus-visible:ring-ring/30 not-data-expanded:not-data-front:h-(--toast-front-height) data-expanded:[--y:calc(0px-var(--toast-offset)-var(--toast-index)*14px)] data-expanded:[scale:1] data-starting-style:transition-none data-starting-style:not-data-front:opacity-0 data-starting-style:data-front:[--y:100%] data-ending-style:opacity-0 data-swiping:transition-none motion-reduce:transition-opacity";

const Toaster = ({
  className,
  ...props
}: Omit<React.ComponentProps<typeof ToastRegion>, "children" | "className"> & {
  className?: string;
}) => (
  <ToastRegion
    aria-label="Notifications"
    className={cn(regionClassName, className)}
    {...props}
  >
    {({ type }) => {
      const Icon = TOAST_ICONS[type];

      return (
        <Toast
          className={toastClassName}
          // Escape on a focused toast dismisses only the toast; Kisa's own
          // Escape commands listen on the document.
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
            }
          }}
        >
          {Icon === undefined ? null : (
            <Icon
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0",
                type === "loading" && "animate-spin"
              )}
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <ToastTitle className="font-medium" />
            <ToastDescription className="text-muted-foreground" />
          </div>
          <ToastAction
            className={cn(buttonVariants({ size: "sm" }), "shrink-0")}
          />
          <ToastClose
            aria-label="Dismiss notification"
            className={cn(
              buttonVariants({ size: "icon-xs", variant: "ghost" }),
              "text-muted-foreground shrink-0 opacity-0 group-focus-within/toast:opacity-100 group-hover/toast:opacity-100"
            )}
          >
            <XIcon aria-hidden="true" />
          </ToastClose>
        </Toast>
      );
    }}
  </ToastRegion>
);

export { Toaster };
