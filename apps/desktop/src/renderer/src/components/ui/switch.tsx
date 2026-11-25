import { Switch as SwitchPrimitive, SwitchThumb } from "@ui-sdk/react/switch";

import { cn } from "@/lib/utils";

const Switch = ({
  className,
  ...props
}: Omit<
  React.ComponentProps<typeof SwitchPrimitive>,
  "className" | "children"
> & {
  className?: string;
}) => (
  <SwitchPrimitive
    className={cn(
      "peer group/switch focus-visible:ring-ring/30 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 data-checked:bg-primary data-unchecked:bg-input dark:data-unchecked:bg-input/80 relative inline-flex h-[16.6px] w-[28px] shrink-0 items-center rounded-full border border-transparent transition-all outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-2 aria-invalid:ring-2 data-disabled:cursor-not-allowed data-disabled:opacity-50",
      className
    )}
    {...props}
  >
    <SwitchThumb className="bg-background dark:data-checked:bg-primary-foreground dark:data-unchecked:bg-foreground pointer-events-none block size-3.5 rounded-full ring-0 transition-transform data-checked:translate-x-[calc(100%-2px)] data-unchecked:translate-x-0" />
  </SwitchPrimitive>
);

export { Switch };
