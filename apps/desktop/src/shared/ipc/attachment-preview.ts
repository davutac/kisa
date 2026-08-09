import type {
  GmailAttachmentPreviewReply,
  GmailAttachmentSaveReply,
} from "./mail";

export interface AttachmentPreviewBridge {
  load: () => Promise<GmailAttachmentPreviewReply>;
  save: () => Promise<GmailAttachmentSaveReply>;
}
