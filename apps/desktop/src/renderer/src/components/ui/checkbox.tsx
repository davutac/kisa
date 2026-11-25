import {
  Checkbox as CheckboxPrimitive,
  CheckboxIndicator,
} from "@ui-sdk/react/checkbox";
import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const Checkbox = ({
  className,
  ...props
}: Omit<
  React.ComponentProps<typeof CheckboxPrimitive>,
  "className" | "children"
> & {
  className?: string;
}) => (
  <CheckboxPrimitive
    className={cn(
      "peer bg-input/50 focus-visible:ring-ring/30 aria-invalid:ring-destructive/20 dark:bg-input/80 dark:aria-invalid:ring-destructive/40 data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-transparent transition-shadow outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-2 aria-invalid:ring-2 data-disabled:cursor-not-allowed data-disabled:opacity-50",
      className
    )}
    {...props}
  >
    <CheckboxIndicator className="grid place-content-center text-current transition-none [&>svg]:size-3.5">
      <CheckIcon aria-hidden="true" />
    </CheckboxIndicator>
  </CheckboxPrimitive>
);

export { Checkbox };
