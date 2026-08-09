import { useMemo, useState } from "react";
import { toast } from "sonner";

import MailAttachmentPill from "@/components/mail/attachment-pill";
import { getMailApi } from "@/platform/desktop";
import { getAttachmentPreviewKind } from "@/shared/attachments";
import type { GmailAttachmentSummary } from "@/shared/ipc/mail";

interface MailAttachmentListProps {
  accountId: string;
  attachments: readonly GmailAttachmentSummary[];
}

type AttachmentAction = "download" | "preview";

const MailAttachmentList = ({
  accountId,
  attachments,
}: MailAttachmentListProps) => {
  const mailApi = useMemo(() => getMailApi(), []);
  const [activeAttachment, setActiveAttachment] = useState<string>();

  const open = async (
    attachment: GmailAttachmentSummary,
    action: AttachmentAction
  ): Promise<void> => {
    if (mailApi === undefined || attachment.attachmentId === undefined) {
      return;
    }

    const key = `${attachment.messageId}:${attachment.attachmentId}`;
    const request = {
      accountId,
      attachmentId: attachment.attachmentId,
      messageId: attachment.messageId,
    };
    setActiveAttachment(key);

    try {
      const reply =
        action === "download"
          ? await mailApi.saveAttachment(request)
          : await mailApi.openAttachmentPreview(request);

      if (!reply.ok) {
        toast.error(reply.error);
      }
    } catch {
      toast.error(
        action === "download"
          ? "Could not save attachment"
          : "Could not open attachment preview"
      );
    } finally {
      setActiveAttachment(undefined);
    }
  };

  return attachments.map((attachment, index) => {
    const key = `${attachment.messageId}:${attachment.attachmentId ?? attachment.filename}:${index}`;
    const action =
      getAttachmentPreviewKind(attachment.filename, attachment.mediaType) ===
      undefined
        ? "download"
        : "preview";

    return (
      <MailAttachmentPill
        action={action}
        attachment={attachment}
        disabled={
          mailApi === undefined ||
          attachment.attachmentId === undefined ||
          activeAttachment !== undefined
        }
        key={key}
        loading={
          activeAttachment ===
          `${attachment.messageId}:${attachment.attachmentId}`
        }
        onClick={() => open(attachment, action)}
      />
    );
  });
};

export default MailAttachmentList;
