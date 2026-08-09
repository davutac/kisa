import type { AttachmentPreviewBridge } from "../shared/ipc/attachment-preview";

declare global {
  interface Window {
    attachmentPreview?: AttachmentPreviewBridge;
  }
}
