import { Loader2Icon } from "lucide-react";

import { cn } from "@/lib/utils";

// Kisa's spinners sit beside text that already says what is loading, so one is
// hidden unless it is given its own name, and only then becomes a status.
const Spinner = ({
  className,
  "aria-label": label,
  ...props
}: React.ComponentProps<"svg">) => (
  <Loader2Icon
    {...(label === undefined
      ? { "aria-hidden": true }
      : { role: "status", "aria-label": label })}
    className={cn("size-4 animate-spin", className)}
    {...props}
  />
);

export { Spinner };
