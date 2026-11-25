import {
  Radio as RadioPrimitive,
  RadioGroup as RadioGroupPrimitive,
  RadioIndicator,
} from "@ui-sdk/react/radio";

import { cn } from "@/lib/utils";

const RadioGroup = <T extends string = string>({
  className,
  ...props
}: Omit<React.ComponentProps<typeof RadioGroupPrimitive<T>>, "className"> & {
  className?: string;
}) => (
  <RadioGroupPrimitive
    className={cn("grid w-full gap-3", className)}
    {...props}
  />
);

const Radio = ({
  className,
  ...props
}: Omit<
  React.ComponentProps<typeof RadioPrimitive>,
  "className" | "children"
> & {
  className?: string;
}) => (
  <RadioPrimitive
    className={cn(
      "peer bg-input/50 focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:bg-input/80 dark:aria-invalid:ring-destructive/40 data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary relative flex aspect-square size-4 shrink-0 rounded-full border border-transparent outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-3 aria-invalid:ring-3 data-disabled:cursor-not-allowed data-disabled:opacity-50",
      className
    )}
    {...props}
  >
    <RadioIndicator className="flex size-4 items-center justify-center">
      <span className="bg-primary-foreground absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full" />
    </RadioIndicator>
  </RadioPrimitive>
);

export { Radio, RadioGroup };
