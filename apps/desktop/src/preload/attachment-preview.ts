import { contextBridge, ipcRenderer } from "electron";

import type { AttachmentPreviewBridge } from "../shared/ipc/attachment-preview";

// Keep this preload entry self-contained. Sharing a runtime module with the
// normal preload makes the bundler emit a relative CommonJS chunk, which a
// sandboxed Electron preload cannot require.
const ATTACHMENT_PREVIEW_LOAD_CHANNEL = "desktop:attachment-preview:load";
const ATTACHMENT_PREVIEW_SAVE_CHANNEL = "desktop:attachment-preview:save";

const attachmentPreview = {
  load: () => ipcRenderer.invoke(ATTACHMENT_PREVIEW_LOAD_CHANNEL),
  save: () => ipcRenderer.invoke(ATTACHMENT_PREVIEW_SAVE_CHANNEL),
} satisfies AttachmentPreviewBridge;

contextBridge.exposeInMainWorld("attachmentPreview", attachmentPreview);
