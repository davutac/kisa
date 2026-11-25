import { CollapsibleTrigger as CollapsibleTriggerPrimitive } from "@ui-sdk/react/collapsible";

import { buttonVariants } from "@/components/ui/button";
import type { ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export { Collapsible, CollapsiblePanel } from "@ui-sdk/react/collapsible";

// Styled like a Button rather than rendered as one: the agent bridge would
// list a Kisa Button inside the trigger as a second control.
const CollapsibleTrigger = ({
  className,
  size = "default",
  variant = "ghost",
  ...props
}: Omit<
  React.ComponentProps<typeof CollapsibleTriggerPrimitive>,
  "className"
> & {
  className?: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
}) => (
  <CollapsibleTriggerPrimitive
    className={cn(buttonVariants({ size, variant }), className)}
    {...props}
  />
);

export { CollapsibleTrigger };
