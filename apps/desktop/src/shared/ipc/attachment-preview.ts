import type {
  MailAttachmentPreviewReply,
  MailAttachmentSaveReply,
} from "./mail";

export interface AttachmentPreviewBridge {
  load: () => Promise<MailAttachmentPreviewReply>;
  save: () => Promise<MailAttachmentSaveReply>;
}
