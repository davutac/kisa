import MailAttachmentPill from "@/components/mail/attachment-pill";
import type { GmailAttachmentSummary } from "@/shared/ipc/mail";

interface MailMessageAttachmentsProps {
  attachments: readonly GmailAttachmentSummary[];
}

const MailMessageAttachments = ({
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
      {attachments.map((attachment, index) => (
        <MailAttachmentPill
          attachment={attachment}
          key={`${attachment.messageId}:${attachment.attachmentId ?? attachment.filename}:${index}`}
        />
      ))}
    </section>
  );
};

export default MailMessageAttachments;
