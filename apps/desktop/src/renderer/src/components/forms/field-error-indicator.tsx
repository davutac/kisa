import { CircleAlertIcon } from "lucide-react";

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
        <button
          aria-label={message}
          className="text-destructive focus-visible:ring-destructive/30 grid size-6 place-items-center rounded-md outline-none focus-visible:ring-2"
          type="button"
        >
          <CircleAlertIcon aria-hidden="true" className="size-3.5" />
          <span className="sr-only" id={id} role="alert">
            {message}
          </span>
        </button>
      }
    />
    <TooltipContent side="top">{message}</TooltipContent>
  </Tooltip>
);

export default FieldErrorIndicator;
