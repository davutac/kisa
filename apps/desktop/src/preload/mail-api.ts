import { ipcRenderer } from "electron";

import type { DesktopBridge } from "../shared/ipc/bridge";
import {
  MAIL_INDEX_PROGRESS_CHANNEL,
  MAIL_LIST_CACHED_THREAD_PAGE_CHANNEL,
  MAIL_LIST_LABELS_CHANNEL,
  MAIL_LIST_SENDERS_CHANNEL,
  MAIL_LIST_TRUSTED_IMAGE_SENDERS_CHANNEL,
  MAIL_LOAD_THREAD_CHANNEL,
  MAIL_SEARCH_THREADS_CHANNEL,
  MAIL_SET_THREAD_READ_CHANNEL,
  MAIL_SYNC_LABELS_CHANNEL,
  MAIL_SYNC_STATUS_CHANNEL,
  MAIL_THREAD_UPDATED_CHANNEL,
  MAIL_THREADS_CHANGED_CHANNEL,
  MAIL_TRASH_THREAD_CHANNEL,
  MAIL_TRUST_IMAGE_SENDER_CHANNEL,
  MAIL_TRUSTED_IMAGE_SENDERS_CHANGED_CHANNEL,
} from "../shared/ipc/channels";
import {
  GmailIndexProgressList,
  GmailSyncStatus,
  GmailThreadUpdated,
  GmailThreadsChanged,
  GmailTrustedImageSendersReply,
} from "../shared/ipc/mail";
import { subscribe } from "./subscribe";

export const mailApi: Pick<
  DesktopBridge,
  | "getMailIndexProgress"
  | "getMailSyncStatus"
  | "listCachedThreadPage"
  | "listGmailLabels"
  | "listGmailSenders"
  | "listTrustedImageSenders"
  | "loadThread"
  | "onMailIndexProgressChanged"
  | "onMailSyncStatusChanged"
  | "onMailThreadUpdated"
  | "onMailThreadsChanged"
  | "onTrustedImageSendersChanged"
  | "searchMail"
  | "setThreadReadState"
  | "syncGmailLabels"
  | "trashThread"
  | "trustImageSender"
> = {
  getMailIndexProgress: () => ipcRenderer.invoke(MAIL_INDEX_PROGRESS_CHANNEL),
  getMailSyncStatus: () => ipcRenderer.invoke(MAIL_SYNC_STATUS_CHANNEL),
  listCachedThreadPage: (request) =>
    ipcRenderer.invoke(MAIL_LIST_CACHED_THREAD_PAGE_CHANNEL, request),
  listGmailLabels: (request) =>
    ipcRenderer.invoke(MAIL_LIST_LABELS_CHANNEL, request),
  listGmailSenders: (request) =>
    ipcRenderer.invoke(MAIL_LIST_SENDERS_CHANNEL, request),
  listTrustedImageSenders: () =>
    ipcRenderer.invoke(MAIL_LIST_TRUSTED_IMAGE_SENDERS_CHANNEL),
  loadThread: (request) =>
    ipcRenderer.invoke(MAIL_LOAD_THREAD_CHANNEL, request),
  onMailIndexProgressChanged: (listener) =>
    subscribe(MAIL_INDEX_PROGRESS_CHANNEL, GmailIndexProgressList, listener),
  onMailSyncStatusChanged: (listener) =>
    subscribe(MAIL_SYNC_STATUS_CHANNEL, GmailSyncStatus, listener),
  onMailThreadUpdated: (listener) =>
    subscribe(MAIL_THREAD_UPDATED_CHANNEL, GmailThreadUpdated, listener),
  onMailThreadsChanged: (listener) =>
    subscribe(MAIL_THREADS_CHANGED_CHANNEL, GmailThreadsChanged, listener),
  onTrustedImageSendersChanged: (listener) =>
    subscribe(
      MAIL_TRUSTED_IMAGE_SENDERS_CHANGED_CHANNEL,
      GmailTrustedImageSendersReply,
      listener
    ),
  searchMail: (request) =>
    ipcRenderer.invoke(MAIL_SEARCH_THREADS_CHANNEL, request),
  setThreadReadState: (request) =>
    ipcRenderer.invoke(MAIL_SET_THREAD_READ_CHANNEL, request),
  syncGmailLabels: (request) =>
    ipcRenderer.invoke(MAIL_SYNC_LABELS_CHANNEL, request),
  trashThread: (request) =>
    ipcRenderer.invoke(MAIL_TRASH_THREAD_CHANNEL, request),
  trustImageSender: (request) =>
    ipcRenderer.invoke(MAIL_TRUST_IMAGE_SENDER_CHANNEL, request),
};
