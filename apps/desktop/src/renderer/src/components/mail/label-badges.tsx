import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatGmailLabel, visibleGmailLabels } from "@/mail/label";
import { useAccountSettings } from "@/state/account-settings";

interface MailLabelBadgesProps {
  accountId: string;
  labels: readonly string[];
  size?: "compact" | "default";
}

const MailLabelBadges = ({
  accountId,
  labels,
  size = "default",
}: MailLabelBadgesProps) => {
  const { showSystemLabels } = useAccountSettings(accountId);

  return visibleGmailLabels(labels, showSystemLabels).map((label) => {
    const displayLabel = formatGmailLabel(label);

    return (
      <Badge
        className={cn(
          "bg-muted text-muted-foreground shrink-0",
          size === "compact"
            ? "h-4 max-w-28 px-1.5 text-[10px]"
            : "h-5 max-w-32 px-2 text-xs"
        )}
        key={label}
        title={displayLabel}
        variant="secondary"
      >
        <span className="truncate">{displayLabel}</span>
      </Badge>
    );
  });
};

export default MailLabelBadges;
