import { TimeInput as TimeInputPrimitive } from "@ui-sdk/react/time-input";

import { cn } from "@/lib/utils";

export { createTimeInputController } from "@ui-sdk/react/time-input";

// The group is the field's surface and carries its focus and invalid rings;
// the segments inside are bare text.
const timeInputClassName =
  "flex h-7 w-full min-w-0 items-center rounded-md border border-transparent bg-input/20 px-2 py-0.5 text-sm tabular-nums transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/30 data-disabled:cursor-not-allowed data-disabled:opacity-50 aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-xs/relaxed dark:bg-input/30 dark:aria-invalid:ring-destructive/40 [&_[data-slot=time-input-segment]]:rounded-sm [&_[data-slot=time-input-segment]]:bg-transparent [&_[data-slot=time-input-segment]]:text-center [&_[data-slot=time-input-segment]]:outline-none [&_[data-slot=time-input-segment]]:placeholder:text-muted-foreground [&_[data-slot=time-input-segment]:focus]:bg-ring/30 [&_[data-slot=time-input-segment][data-type=dayPeriod]]:ml-1 [&_[data-slot=time-input-segment][data-type=literal]]:text-muted-foreground";

const TimeInput = ({
  className,
  ...props
}: Omit<React.ComponentProps<typeof TimeInputPrimitive>, "className"> & {
  className?: string;
}) => (
  <TimeInputPrimitive
    className={cn(timeInputClassName, className)}
    {...props}
  />
);

export { TimeInput };
