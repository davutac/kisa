import { ipcRenderer } from "electron";

import type { DesktopBridge } from "../shared/ipc/bridge";
import {
  AI_CATEGORIZE_THREAD_CHANNEL,
  AI_CLEANUP_DRAFT_CHANNEL,
  AI_GENERATE_REPLY_CHANNEL,
  AI_GET_SETTINGS_CHANNEL,
  AI_LIST_PROVIDERS_CHANNEL,
  AI_UPDATE_SETTINGS_CHANNEL,
} from "../shared/ipc/channels";

export const aiApi: Pick<
  DesktopBridge,
  | "categorizeThread"
  | "cleanupEmailDraft"
  | "generateEmailReply"
  | "getAiSettings"
  | "listAiProviders"
  | "updateAiSettings"
> = {
  categorizeThread: (request) =>
    ipcRenderer.invoke(AI_CATEGORIZE_THREAD_CHANNEL, request),
  cleanupEmailDraft: (request) =>
    ipcRenderer.invoke(AI_CLEANUP_DRAFT_CHANNEL, request),
  generateEmailReply: (request) =>
    ipcRenderer.invoke(AI_GENERATE_REPLY_CHANNEL, request),
  getAiSettings: () => ipcRenderer.invoke(AI_GET_SETTINGS_CHANNEL),
  listAiProviders: () => ipcRenderer.invoke(AI_LIST_PROVIDERS_CHANNEL),
  updateAiSettings: (request) =>
    ipcRenderer.invoke(AI_UPDATE_SETTINGS_CHANNEL, request),
};
