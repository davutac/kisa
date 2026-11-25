import { Label as LabelPrimitive } from "@ui-sdk/react/label";

import { cn } from "@/lib/utils";

const labelClassName =
  "flex items-center gap-2 text-xs/relaxed leading-none font-medium select-none group-data-disabled:pointer-events-none group-data-disabled:opacity-50 peer-data-disabled:cursor-not-allowed peer-data-disabled:opacity-50";

const Label = ({
  className,
  ...props
}: Omit<React.ComponentProps<typeof LabelPrimitive>, "className"> & {
  className?: string;
}) => <LabelPrimitive className={cn(labelClassName, className)} {...props} />;

export { Label, labelClassName };
