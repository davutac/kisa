import { formatISO } from "date-fns";
import type { ComponentProps } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCalendar } from "@/hooks/use-calendar";
import { cn } from "@/lib/utils";
import { formatExactMailDate, formatMailDate } from "@/mail/mail-date";
import type { MailDateVariant } from "@/mail/mail-date";

type TooltipSide = ComponentProps<typeof TooltipContent>["side"];

interface MailDateProps {
  readonly className?: string;
  /** Replaces the tooltip, for example to name a delivery's time zone. */
  readonly exactDateLabel?: string;
  readonly timestamp: number;
  /**
   * Off where the date sits under another control's hit area, such as a
   * mailbox row, so a tooltip could never open and would only cost a mount.
   */
  readonly tooltip?: boolean;
  /** Matches neighbouring controls' tooltips, such as a header's buttons. */
  readonly tooltipSide?: TooltipSide;
  readonly variant?: MailDateVariant;
}

const MailDate = ({
  className,
  exactDateLabel,
  timestamp,
  tooltip = true,
  tooltipSide,
  variant = "compact",
}: MailDateProps) => {
  const calendar = useCalendar();
  const exactDate = exactDateLabel ?? formatExactMailDate(timestamp, calendar);

  const time = (
    <time
      aria-label={exactDate}
      className={cn("shrink-0 whitespace-nowrap tabular-nums", className)}
      dateTime={formatISO(timestamp)}
    >
      {formatMailDate(timestamp, calendar, variant)}
    </time>
  );

  if (!tooltip) {
    return time;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={time} />
      <TooltipContent side={tooltipSide}>{exactDate}</TooltipContent>
    </Tooltip>
  );
};

export default MailDate;
