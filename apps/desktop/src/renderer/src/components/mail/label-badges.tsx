import type { ReactNode } from "react";

import MailLabelBadge from "@/components/mail/mail-label-badge";
import { formatLabel, sortLabelNames, filterVisibleLabels } from "@/mail/label";
import { useAccountSettings } from "@/state/account-settings";
import { useLabelColors } from "@/state/labels";

interface MailLabelBadgesProps {
  accountId: string;
  empty?: ReactNode;
  labels: readonly string[];
  /** A label implied by where the badges are shown, such as the mailbox. */
  omitLabel?: string;
  onRemoveLabel?: (label: string) => void;
  removableLabels?: ReadonlySet<string>;
  size?: "compact" | "default";
}

const MailLabelBadges = ({
  accountId,
  empty = null,
  labels,
  omitLabel,
  onRemoveLabel,
  removableLabels,
  size = "default",
}: MailLabelBadgesProps) => {
  const { showSystemLabels } = useAccountSettings(accountId);
  const colorsByName = useLabelColors(accountId, labels);
  const visibleLabels = sortLabelNames(
    filterVisibleLabels(labels, showSystemLabels).filter(
      (label) => label !== omitLabel
    )
  );

  if (visibleLabels.length === 0) {
    return empty;
  }

  return visibleLabels.map((label) => {
    const displayLabel = formatLabel(label);
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
