import { CalendarClockIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getHotkeyAriaLabel, HotkeyHint } from "@/hotkeys";

const TitlebarScheduledButton = ({
  attentionCount,
  isOpen,
  onToggle,
}: {
  readonly attentionCount: number;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
}) => {
  const attentionLabel =
    attentionCount === 0
      ? "Scheduled"
      : `Scheduled, ${attentionCount} ${attentionCount === 1 ? "email needs" : "emails need"} attention`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-keyshortcuts={getHotkeyAriaLabel("app.openScheduled")}
            aria-label={attentionLabel}
            aria-pressed={isOpen}
            className="relative"
            onClick={onToggle}
            size="icon"
            type="button"
            variant={isOpen ? "secondary" : "ghost"}
          />
        }
      >
        <CalendarClockIcon />
        {attentionCount === 0 ? null : (
          <span
            aria-hidden="true"
            className="bg-destructive text-destructive-foreground ring-background absolute -top-1 -right-1 min-w-4 rounded-full px-1 text-center text-[9px] leading-4 tabular-nums ring-2"
          >
            {attentionCount > 99 ? "99+" : attentionCount}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent className="flex flex-col items-start gap-1" side="bottom">
        <span className="flex items-center gap-2">
          Scheduled
          <HotkeyHint command="app.openScheduled" />
        </span>
        {attentionCount === 0 ? null : (
          <span className="opacity-70">{attentionCount} need attention</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
};

export default TitlebarScheduledButton;
