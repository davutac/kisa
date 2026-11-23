import { AccordionTrigger as AccordionTriggerPrimitive } from "@ui-sdk/react/accordion";

import { buttonVariants } from "@/components/ui/button";
import type { ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
} from "@ui-sdk/react/accordion";

// Styled like a Button rather than rendered as one: the agent bridge would
// list a Kisa Button inside the trigger as a second control.
const AccordionTrigger = ({
  className,
  size = "default",
  variant = "ghost",
  ...props
}: Omit<React.ComponentProps<typeof AccordionTriggerPrimitive>, "className"> & {
  className?: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
}) => (
  <AccordionTriggerPrimitive
    className={cn(buttonVariants({ size, variant }), className)}
    {...props}
  />
);

export { AccordionTrigger };
