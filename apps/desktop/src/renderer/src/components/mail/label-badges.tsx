import type { ReactNode } from "react";

import MailLabelBadge from "@/components/mail/mail-label-badge";
import {
  formatGmailLabel,
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
      <MailLabelBadge
        color={colorsByName.get(label)}
        key={label}
        label={displayLabel}
        onRemove={canRemove ? () => onRemoveLabel(label) : undefined}
        size={size}
      />
    );
  });
};

export default MailLabelBadges;
