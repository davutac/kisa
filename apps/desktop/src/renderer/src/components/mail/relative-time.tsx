import { format, formatDistanceToNow, formatISO } from "date-fns";
import { enUS } from "date-fns/locale";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface MailRelativeTimeProps {
  className?: string;
  exactDateLabel?: string;
  timestamp: number;
}

const MailRelativeTime = ({
  className,
  exactDateLabel,
  timestamp,
}: MailRelativeTimeProps) => {
  const fullDate =
    exactDateLabel ?? format(timestamp, "PPpp", { locale: enUS });
  const relativeTime = formatDistanceToNow(timestamp, {
    includeSeconds: false,
    locale: enUS,
  });

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <time
            aria-label={fullDate}
            className={cn("shrink-0 whitespace-nowrap tabular-nums", className)}
            dateTime={formatISO(timestamp)}
          >
            {relativeTime}
          </time>
        }
      />
      <TooltipContent>{fullDate}</TooltipContent>
    </Tooltip>
  );
};

export default MailRelativeTime;
