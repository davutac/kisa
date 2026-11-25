import { Textarea as TextareaPrimitive } from "@ui-sdk/react/textarea";

import { cn } from "@/lib/utils";

const Textarea = ({
  className,
  ...props
}: Omit<React.ComponentProps<typeof TextareaPrimitive>, "className"> & {
  className?: string;
}) => (
  <TextareaPrimitive
    className={cn(
      "bg-input/20 placeholder:text-muted-foreground focus-visible:ring-ring/30 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:ring-destructive/40 flex field-sizing-content min-h-16 w-full resize-none rounded-md border border-transparent px-2 py-2 text-sm transition-colors outline-none focus-visible:ring-2 aria-invalid:ring-2 data-disabled:cursor-not-allowed data-disabled:opacity-50 md:text-xs/relaxed",
      className
    )}
    {...props}
  />
);

export { Textarea };
