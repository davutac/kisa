import { CalendarClockIcon } from "lucide-react";

import { SidebarRow } from "./sidebar-row";

const formatAttentionLabel = (attentionCount: number): string =>
  attentionCount === 0
    ? "Scheduled"
    : `Scheduled, ${attentionCount} ${attentionCount === 1 ? "email needs" : "emails need"} attention`;

const SidebarScheduledRow = ({
  attentionCount,
  isCurrent,
  onSelect,
}: {
  readonly attentionCount: number;
  readonly isCurrent: boolean;
  readonly onSelect: () => void;
}) => (
  <SidebarRow
    ariaLabel={formatAttentionLabel(attentionCount)}
    command="app.openScheduled"
    icon={<CalendarClockIcon />}
    isCurrent={isCurrent}
    label="Scheduled"
    onSelect={onSelect}
    tooltipDetail={
      attentionCount === 0 ? undefined : (
        <span className="opacity-70">{attentionCount} need attention</span>
      )
    }
    trailing={
      attentionCount === 0 ? undefined : (
        <span
          aria-hidden="true"
          className="bg-destructive text-destructive-foreground min-w-4 shrink-0 rounded-full px-1 text-center text-[10px] leading-4 font-medium tabular-nums"
        >
          {attentionCount > 99 ? "99+" : attentionCount}
        </span>
      )
    }
  />
);

export default SidebarScheduledRow;
