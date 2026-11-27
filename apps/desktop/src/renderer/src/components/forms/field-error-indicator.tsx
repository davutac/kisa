import { CircleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface FieldErrorIndicatorProps {
  readonly id: string;
  readonly message: string;
}

const FieldErrorIndicator = ({ id, message }: FieldErrorIndicatorProps) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <Button
          aria-label={message}
          className="text-destructive hover:text-destructive focus-visible:ring-destructive/30 border-0 hover:bg-transparent active:not-aria-[haspopup]:scale-100 dark:hover:bg-transparent"
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <CircleAlertIcon aria-hidden="true" className="size-3.5" />
          <span className="sr-only" id={id} role="alert">
            {message}
          </span>
        </Button>
      }
    />
    <TooltipContent side="top">{message}</TooltipContent>
  </Tooltip>
);

export default FieldErrorIndicator;
