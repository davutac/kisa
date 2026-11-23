import {
  Progress as ProgressPrimitive,
  ProgressIndicator as ProgressIndicatorPrimitive,
  ProgressLabel as ProgressLabelPrimitive,
  ProgressTrack as ProgressTrackPrimitive,
  ProgressValue as ProgressValuePrimitive,
} from "@ui-sdk/react/progress";

import { cn } from "@/lib/utils";

type WithClassName<Props> = Omit<Props, "className"> & { className?: string };

const Progress = ({
  className,
  ...props
}: WithClassName<React.ComponentProps<typeof ProgressPrimitive>>) => (
  <ProgressPrimitive
    className={cn("flex items-center gap-1.5", className)}
    {...props}
  />
);

const ProgressTrack = ({
  className,
  ...props
}: WithClassName<React.ComponentProps<typeof ProgressTrackPrimitive>>) => (
  <ProgressTrackPrimitive
    className={cn(
      "bg-muted relative h-1 w-full overflow-hidden rounded-full",
      className
    )}
    {...props}
  />
);

const ProgressIndicator = ({
  className,
  ...props
}: WithClassName<React.ComponentProps<typeof ProgressIndicatorPrimitive>>) => (
  <ProgressIndicatorPrimitive
    className={cn(
      "bg-primary absolute inset-y-0 rounded-full transition-[width] data-indeterminate:w-full data-indeterminate:animate-pulse",
      className
    )}
    {...props}
  />
);

const ProgressLabel = ({
  className,
  ...props
}: WithClassName<React.ComponentProps<typeof ProgressLabelPrimitive>>) => (
  <ProgressLabelPrimitive
    className={cn("text-xs font-medium", className)}
    {...props}
  />
);

const ProgressValue = ({
  className,
  ...props
}: WithClassName<React.ComponentProps<typeof ProgressValuePrimitive>>) => (
  <ProgressValuePrimitive
    className={cn("text-xs tabular-nums", className)}
    {...props}
  />
);

// The arc reads `--progress-value`, not the indicator's inline width, which is
// pinned; `--progress-ring-color` tints the arc only.
const ringMask =
  "[mask:radial-gradient(circle_closest-side,transparent_60%,black_62%)]";

const ProgressRing = ({ className }: { className?: string }) => (
  <ProgressTrackPrimitive
    className={cn(
      "relative grid size-4 shrink-0 place-items-center",
      className
    )}
  >
    <span
      aria-hidden="true"
      className={cn(
        "absolute inset-0 rounded-full bg-current opacity-25",
        ringMask
      )}
    />
    <ProgressIndicatorPrimitive
      className={cn(
        "absolute inset-0 w-auto! rounded-full bg-[conic-gradient(var(--progress-ring-color,currentColor)_var(--progress-value),transparent_0)] data-indeterminate:animate-spin data-indeterminate:bg-[conic-gradient(var(--progress-ring-color,currentColor)_25%,transparent_0)]",
        ringMask
      )}
    />
  </ProgressTrackPrimitive>
);

export {
  Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressRing,
  ProgressTrack,
  ProgressValue,
};
