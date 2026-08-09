import MailLabelBadges from "@/components/mail/label-badges";
import { visibleGmailLabels } from "@/mail/label";
import { useAccountSettings } from "@/state/account-settings";

interface ThreadLabelsProps {
  accountId: string;
  labels: readonly string[];
}

const ThreadLabels = ({ accountId, labels }: ThreadLabelsProps) => {
  const { showSystemLabels } = useAccountSettings(accountId);
  const visibleLabels = visibleGmailLabels(labels, showSystemLabels);

  if (visibleLabels.length === 0) {
    return null;
  }

  return (
    <div className="no-scrollbar bg-card flex min-w-0 gap-1 overflow-x-auto overscroll-x-contain p-4">
      <MailLabelBadges accountId={accountId} labels={visibleLabels} />
    </div>
  );
};

export default ThreadLabels;
