import NumberFlow from "@number-flow/react";
import {
  Toast,
  ToastAction,
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
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAnimationsEnabled } from "@/state/app-settings";

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
  "absolute inset-x-0 bottom-0 z-[calc(100-var(--toast-index))] flex h-(--toast-height) items-center gap-2 overflow-hidden rounded-lg border bg-popover p-4 text-[13px] text-popover-foreground shadow-lg outline-none select-none [--y:calc(0px-var(--toast-index)*14px)] [scale:calc(1-var(--toast-index)*0.05)] [translate:var(--toast-swipe-x,0px)_calc(var(--y)+var(--toast-swipe-y,0px))] transition-[translate,scale,opacity,height] duration-400 ease-out focus-visible:ring-2 focus-visible:ring-ring/30 not-data-expanded:not-data-front:h-(--toast-front-height) data-expanded:[--y:calc(0px-var(--toast-offset)-var(--toast-index)*14px)] data-expanded:[scale:1] data-starting-style:transition-none data-starting-style:not-data-front:opacity-0 data-starting-style:data-front:[--y:100%] data-ending-style:opacity-0 data-swiping:transition-none motion-reduce:transition-opacity";

/**
 * A toast's `data` for counting down to a deadline `durationMs` away. The
 * deadline is the wall clock's, not the toast's timer, which pauses while
 * the pointer or focus is on it.
 */
export class ToastCountdown {
  readonly durationMs: number;
  readonly endsAt: number;

  constructor(durationMs: number) {
    this.durationMs = durationMs;
    this.endsAt = Date.now() + durationMs;
  }
}

/** Whole seconds left until `endsAt`, as a countdown shows them. */
const secondsLeft = (endsAt: number, now: number): number =>
  Math.max(0, Math.ceil((endsAt - now) / 1000));

/**
 * A bar that fills the toast from left to right as the deadline nears, and
 * the seconds left before the title. The bar runs as one CSS animation,
 * offset by the time already gone so a remount picks up where it was; each
 * second's re-render also sets where it stands, for when animations are off.
 * Once time is up and the toast is still waiting, a spinner takes the
 * number's place. Decorative: the title says what is happening.
 */
const Countdown = ({
  countdown: { durationMs, endsAt },
}: {
  readonly countdown: ToastCountdown;
}) => {
  const animated = useAnimationsEnabled();

  const [clock, setClock] = useState(() => {
    const at = Date.now();

    return { mountedAt: at, now: at };
  });

  const { mountedAt, now } = clock;
  const seconds = secondsLeft(endsAt, now);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Wakes as the whole second shown changes, until none is left.
    const schedule = (at: number): void => {
      const left = endsAt - at;
      timer = setTimeout(wake, left <= 0 ? 0 : left % 1000 || 1000);
    };

    const wake = (): void => {
      const at = Date.now();
      setClock((previous) => ({ ...previous, now: at }));

      if (endsAt > at) {
        schedule(at);
      }
    };

    schedule(Date.now());

    return () => clearTimeout(timer);
  }, [endsAt]);

  const startsAt = endsAt - durationMs;
  const filled = Math.min(1, (now - startsAt) / durationMs);

  return (
    <>
      <span
        aria-hidden="true"
        className="bg-foreground/6 absolute inset-0 -z-10 origin-left"
        style={{
          animation: `toast-countdown ${durationMs}ms linear ${startsAt - mountedAt}ms forwards`,
          transform: `scaleX(${filled})`,
        }}
      />
      <span
        aria-hidden="true"
        className="flex min-w-7 shrink-0 items-center justify-center font-mono text-[22px] leading-none font-medium tabular-nums"
        data-slot="toast-countdown"
      >
        {seconds === 0 ? (
          <Loader2Icon className="size-6 animate-spin" />
        ) : (
          <NumberFlow animated={animated} trend={-1} value={seconds} />
        )}
      </span>
    </>
  );
};

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
    {({ data, type }) => {
      const Icon = TOAST_ICONS[type];
      const isCounting = data instanceof ToastCountdown;
      let leading: React.ReactNode = null;

      if (isCounting) {
        leading = <Countdown countdown={data} />;
      } else if (Icon !== undefined) {
        leading = (
          <Icon
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0",
              type === "loading" && "animate-spin"
            )}
          />
        );
      }

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
          {leading}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {/* A counting toast puts its title, who it is for, as a caption
                over its description, what it is, one line each; any other
                keeps a long subject or error to three lines. */}
            <ToastTitle
              className={cn(
                "font-medium",
                isCounting &&
                  "text-muted-foreground truncate text-[10.5px] font-semibold tracking-wider uppercase"
              )}
            />
            <ToastDescription
              className={cn(
                "wrap-break-word",
                isCounting
                  ? "truncate font-medium"
                  : "text-muted-foreground line-clamp-3"
              )}
            />
          </div>
          <ToastAction
            className={cn(buttonVariants({ size: "sm" }), "shrink-0")}
          />
        </Toast>
      );
    }}
  </ToastRegion>
);

export { Toaster };
