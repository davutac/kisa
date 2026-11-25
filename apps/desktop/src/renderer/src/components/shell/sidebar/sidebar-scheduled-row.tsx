import { CalendarClockIcon } from "lucide-react";

import { SidebarCountBadge, SidebarRow } from "./sidebar-row";

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
        <SidebarCountBadge count={attentionCount} tone="attention" />
      )
    }
  />
);

export default SidebarScheduledRow;
