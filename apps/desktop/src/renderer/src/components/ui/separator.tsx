import { Separator as SeparatorPrimitive } from "@ui-sdk/react/separator";

import { cn } from "@/lib/utils";

const Separator = ({
  className,
  orientation = "horizontal",
  ...props
}: Omit<React.ComponentProps<typeof SeparatorPrimitive>, "className"> & {
  className?: string;
}) => (
  <SeparatorPrimitive
    orientation={orientation}
    className={cn(
      "bg-border shrink-0 data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
      className
    )}
    {...props}
  />
);

export { Separator };
