import { ipcRenderer } from "electron";

import type { DesktopBridge } from "../shared/ipc/bridge";
import {
  MAIL_LIST_CACHED_THREAD_PAGE_CHANNEL,
  MAIL_LIST_LABELS_CHANNEL,
  MAIL_LIST_TRUSTED_IMAGE_SENDERS_CHANNEL,
  MAIL_LOAD_THREAD_CHANNEL,
  MAIL_LOAD_THREAD_PAGE_CHANNEL,
  MAIL_SET_THREAD_READ_CHANNEL,
  MAIL_SYNC_LABELS_CHANNEL,
  MAIL_SYNC_STATUS_CHANNEL,
  MAIL_THREADS_CHANGED_CHANNEL,
  MAIL_TRASH_THREAD_CHANNEL,
  MAIL_TRUST_IMAGE_SENDER_CHANNEL,
  MAIL_TRUSTED_IMAGE_SENDERS_CHANGED_CHANNEL,
} from "../shared/ipc/channels";
import {
  GmailSyncStatus,
  GmailThreadsChanged,
  GmailTrustedImageSendersReply,
} from "../shared/ipc/mail";
import { subscribe } from "./subscribe";

export const mailApi: Pick<
  DesktopBridge,
  | "getMailSyncStatus"
  | "listCachedThreadPage"
  | "listGmailLabels"
  | "listTrustedImageSenders"
  | "loadThread"
  | "loadThreadPage"
  | "onMailSyncStatusChanged"
  | "onMailThreadsChanged"
  | "onTrustedImageSendersChanged"
  | "setThreadReadState"
  | "syncGmailLabels"
  | "trashThread"
  | "trustImageSender"
> = {
  getMailSyncStatus: () => ipcRenderer.invoke(MAIL_SYNC_STATUS_CHANNEL),
  listCachedThreadPage: (request) =>
    ipcRenderer.invoke(MAIL_LIST_CACHED_THREAD_PAGE_CHANNEL, request),
  listGmailLabels: (request) =>
    ipcRenderer.invoke(MAIL_LIST_LABELS_CHANNEL, request),
  listTrustedImageSenders: () =>
    ipcRenderer.invoke(MAIL_LIST_TRUSTED_IMAGE_SENDERS_CHANNEL),
  loadThread: (request) =>
    ipcRenderer.invoke(MAIL_LOAD_THREAD_CHANNEL, request),
  loadThreadPage: (request) =>
    ipcRenderer.invoke(MAIL_LOAD_THREAD_PAGE_CHANNEL, request),
  onMailSyncStatusChanged: (listener) =>
    subscribe(MAIL_SYNC_STATUS_CHANNEL, GmailSyncStatus, listener),
  onMailThreadsChanged: (listener) =>
    subscribe(MAIL_THREADS_CHANGED_CHANNEL, GmailThreadsChanged, listener),
  onTrustedImageSendersChanged: (listener) =>
    subscribe(
      MAIL_TRUSTED_IMAGE_SENDERS_CHANGED_CHANNEL,
      GmailTrustedImageSendersReply,
      listener
    ),
  setThreadReadState: (request) =>
    ipcRenderer.invoke(MAIL_SET_THREAD_READ_CHANNEL, request),
  syncGmailLabels: (request) =>
    ipcRenderer.invoke(MAIL_SYNC_LABELS_CHANNEL, request),
  trashThread: (request) =>
    ipcRenderer.invoke(MAIL_TRASH_THREAD_CHANNEL, request),
  trustImageSender: (request) =>
    ipcRenderer.invoke(MAIL_TRUST_IMAGE_SENDER_CHANNEL, request),
};
