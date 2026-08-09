import MailAttachmentList from "@/components/mail/attachment-list";
import type { GmailAttachmentSummary } from "@/shared/ipc/mail";

interface MailMessageAttachmentsProps {
  accountId: string;
  attachments: readonly GmailAttachmentSummary[];
}

const MailMessageAttachments = ({
  accountId,
  attachments,
}: MailMessageAttachmentsProps) => {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Attachments"
      className="bg-card flex flex-wrap gap-2 p-4"
    >
      <MailAttachmentList accountId={accountId} attachments={attachments} />
    </section>
  );
};

export default MailMessageAttachments;
