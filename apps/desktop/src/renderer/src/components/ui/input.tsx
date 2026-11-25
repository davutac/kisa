import { Input as InputPrimitive } from "@ui-sdk/react/input";
import { createContext, use } from "react";

import { cn } from "@/lib/utils";

const inputClassName =
  "h-7 w-full min-w-0 rounded-md border border-transparent bg-input/20 px-2 py-0.5 text-sm transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs/relaxed file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30 data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50 aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-xs/relaxed dark:bg-input/30 dark:aria-invalid:ring-destructive/40";

// The group draws the field's surface and focus ring, so an input inside one
// gets none of its own rather than relying on overrides winning in CSS.
const groupedInputClassName =
  "h-7 w-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-2 py-0.5 text-sm shadow-none transition-colors outline-none placeholder:text-muted-foreground data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50 md:text-xs/relaxed";

const InputGroupContext = createContext(false);

const Input = ({
  className,
  ...props
}: Omit<React.ComponentProps<typeof InputPrimitive>, "className"> & {
  className?: string;
}) => {
  const isGrouped = use(InputGroupContext);

  return (
    <InputPrimitive
      className={cn(
        isGrouped ? groupedInputClassName : inputClassName,
        className
      )}
      {...props}
    />
  );
};

export { Input, InputGroupContext, inputClassName };
