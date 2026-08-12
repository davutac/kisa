import { XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  formatGmailLabel,
  gmailLabelColorStyle,
  sortGmailLabelNames,
  visibleGmailLabels,
} from "@/mail/label";
import { useAccountSettings } from "@/state/account-settings";
import { useGmailLabelColors } from "@/state/gmail-labels";

interface MailLabelBadgesProps {
  accountId: string;
  empty?: ReactNode;
  labels: readonly string[];
  onRemoveLabel?: (label: string) => void;
  removableLabels?: ReadonlySet<string>;
  size?: "compact" | "default";
}

const MailLabelBadges = ({
  accountId,
  empty = null,
  labels,
  onRemoveLabel,
  removableLabels,
  size = "default",
}: MailLabelBadgesProps) => {
  const { showSystemLabels } = useAccountSettings(accountId);
  const colorsByName = useGmailLabelColors(accountId, labels);
  const visibleLabels = sortGmailLabelNames(
    visibleGmailLabels(labels, showSystemLabels)
  );

  if (visibleLabels.length === 0) {
    return empty;
  }

  return visibleLabels.map((label) => {
    const displayLabel = formatGmailLabel(label);
    const canRemove =
      onRemoveLabel !== undefined && removableLabels?.has(label) === true;

    return (
      <Badge
        className={cn(
          "bg-muted text-muted-foreground shrink-0",
          canRemove && "gap-0",
          size === "compact" ? "h-4 px-1.5 text-[10px]" : "h-5 px-2 text-xs"
        )}
        key={label}
        style={gmailLabelColorStyle(colorsByName.get(label))}
        title={displayLabel}
        variant="secondary"
      >
        <span
          className={cn(
            "truncate",
            size === "compact" ? "max-w-28" : "max-w-32"
          )}
        >
          {displayLabel}
        </span>
        {canRemove ? (
          <button
            aria-label={`Remove ${displayLabel}`}
            className="pointer-events-none flex h-3 w-0 shrink-0 items-center justify-center overflow-hidden rounded-full opacity-0 transition-[width,margin,opacity] group-hover/badge:pointer-events-auto group-hover/badge:ml-0.5 group-hover/badge:w-3 group-hover/badge:opacity-100 focus-visible:pointer-events-auto focus-visible:ml-0.5 focus-visible:w-3 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-current focus-visible:outline-none"
            onClick={(event) => {
              event.stopPropagation();
              onRemoveLabel?.(label);
            }}
            title={`Remove ${displayLabel}`}
            type="button"
          >
            <XIcon className="size-2.5" />
          </button>
        ) : null}
      </Badge>
    );
  });
};

export default MailLabelBadges;
