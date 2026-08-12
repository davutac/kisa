import { ipcRenderer, webUtils } from "electron";

import type { DesktopBridge } from "../shared/ipc/bridge";
import {
  MAIL_INDEX_PROGRESS_CHANNEL,
  MAIL_BULK_MUTATE_THREADS_CHANNEL,
  MAIL_DELETE_SPAM_THREAD_CHANNEL,
  MAIL_GET_SPAM_STATUS_CHANNEL,
  MAIL_DISCARD_DRAFT_CHANNEL,
  MAIL_DRAFT_CHANGED_CHANNEL,
  MAIL_LIST_CACHED_THREAD_PAGE_CHANNEL,
  MAIL_LIST_LABELS_CHANNEL,
  MAIL_LIST_SENDERS_CHANNEL,
  MAIL_LIST_TRUSTED_IMAGE_SENDERS_CHANNEL,
  MAIL_LIST_STASHED_DRAFTS_CHANNEL,
  MAIL_LOAD_THREAD_CHANNEL,
  MAIL_LOAD_THREAD_DRAFT_CHANNEL,
  MAIL_MARK_THREAD_NOT_SPAM_CHANNEL,
  MAIL_OPEN_ATTACHMENT_PREVIEW_CHANNEL,
  MAIL_PREPARE_OUTGOING_ATTACHMENTS_CHANNEL,
  MAIL_SAVE_ATTACHMENT_CHANNEL,
  MAIL_SAVE_DRAFT_CHANNEL,
  MAIL_SEARCH_THREADS_CHANNEL,
  MAIL_AUTHORIZE_OUTGOING_ATTACHMENTS_CHANNEL,
  MAIL_SEND_MESSAGE_CHANNEL,
  MAIL_SEND_THREAD_MESSAGE_CHANNEL,
  MAIL_SET_THREAD_LABEL_CHANNEL,
  MAIL_SET_THREAD_READ_CHANNEL,
  MAIL_SYNC_LABELS_CHANNEL,
  MAIL_SYNC_STATUS_CHANNEL,
  MAIL_THREAD_LIST_UPDATED_CHANNEL,
  MAIL_THREAD_UPDATED_CHANNEL,
  MAIL_TRASH_THREAD_CHANNEL,
  MAIL_TRUST_IMAGE_SENDER_CHANNEL,
  MAIL_TRUSTED_IMAGE_SENDERS_CHANGED_CHANNEL,
} from "../shared/ipc/channels";
import {
  GmailIndexProgressList,
  GmailSyncStatus,
  GmailThreadListUpdated,
  GmailThreadUpdated,
  GmailTrustedImageSendersReply,
  MailDraftChanged,
} from "../shared/ipc/mail";
import { subscribe } from "./subscribe";

export const mailApi: Pick<
  DesktopBridge,
  | "discardMailDraft"
  | "bulkMutateThreads"
  | "authorizeOutgoingAttachments"
  | "deleteSpamThread"
  | "getMailIndexProgress"
  | "getMailSyncStatus"
  | "getSpamStatus"
  | "listCachedThreadPage"
  | "listGmailLabels"
  | "listGmailSenders"
  | "listStashedDrafts"
  | "listTrustedImageSenders"
  | "loadThread"
  | "loadThreadDraft"
  | "markThreadNotSpam"
  | "openAttachmentPreview"
  | "prepareOutgoingAttachments"
  | "onMailDraftChanged"
  | "onMailIndexProgressChanged"
  | "onMailSyncStatusChanged"
  | "onMailThreadListUpdated"
  | "onMailThreadUpdated"
  | "onTrustedImageSendersChanged"
  | "searchMail"
  | "saveAttachment"
  | "saveMailDraft"
  | "sendMessage"
  | "sendThreadMessage"
  | "setThreadLabel"
  | "setThreadReadState"
  | "syncGmailLabels"
  | "trashThread"
  | "trustImageSender"
> = {
  authorizeOutgoingAttachments: (files) =>
    ipcRenderer.invoke(MAIL_AUTHORIZE_OUTGOING_ATTACHMENTS_CHANNEL, {
      // Renderer-created File objects have no Electron-backed path. Only files
      // selected or dropped by the user can cross this narrow preload boundary.
      files: files.map((file) => ({
        mediaType: file.type,
        path: webUtils.getPathForFile(file),
      })),
    }),
  bulkMutateThreads: (request) =>
    ipcRenderer.invoke(MAIL_BULK_MUTATE_THREADS_CHANNEL, request),
  deleteSpamThread: (request) =>
    ipcRenderer.invoke(MAIL_DELETE_SPAM_THREAD_CHANNEL, request),
  discardMailDraft: (request) =>
    ipcRenderer.invoke(MAIL_DISCARD_DRAFT_CHANNEL, request),
  getMailIndexProgress: () => ipcRenderer.invoke(MAIL_INDEX_PROGRESS_CHANNEL),
  getMailSyncStatus: () => ipcRenderer.invoke(MAIL_SYNC_STATUS_CHANNEL),
  getSpamStatus: (request) =>
    ipcRenderer.invoke(MAIL_GET_SPAM_STATUS_CHANNEL, request),
  listCachedThreadPage: (request) =>
    ipcRenderer.invoke(MAIL_LIST_CACHED_THREAD_PAGE_CHANNEL, request),
  listGmailLabels: (request) =>
    ipcRenderer.invoke(MAIL_LIST_LABELS_CHANNEL, request),
  listGmailSenders: (request) =>
    ipcRenderer.invoke(MAIL_LIST_SENDERS_CHANNEL, request),
  listStashedDrafts: (request) =>
    ipcRenderer.invoke(MAIL_LIST_STASHED_DRAFTS_CHANNEL, request),
  listTrustedImageSenders: () =>
    ipcRenderer.invoke(MAIL_LIST_TRUSTED_IMAGE_SENDERS_CHANNEL),
  loadThread: (request) =>
    ipcRenderer.invoke(MAIL_LOAD_THREAD_CHANNEL, request),
  loadThreadDraft: (request) =>
    ipcRenderer.invoke(MAIL_LOAD_THREAD_DRAFT_CHANNEL, request),
  markThreadNotSpam: (request) =>
    ipcRenderer.invoke(MAIL_MARK_THREAD_NOT_SPAM_CHANNEL, request),
  onMailDraftChanged: (listener) =>
    subscribe(MAIL_DRAFT_CHANGED_CHANNEL, MailDraftChanged, listener),
  onMailIndexProgressChanged: (listener) =>
    subscribe(MAIL_INDEX_PROGRESS_CHANNEL, GmailIndexProgressList, listener),
  onMailSyncStatusChanged: (listener) =>
    subscribe(MAIL_SYNC_STATUS_CHANNEL, GmailSyncStatus, listener),
  onMailThreadListUpdated: (listener) =>
    subscribe(
      MAIL_THREAD_LIST_UPDATED_CHANNEL,
      GmailThreadListUpdated,
      listener
    ),
  onMailThreadUpdated: (listener) =>
    subscribe(MAIL_THREAD_UPDATED_CHANNEL, GmailThreadUpdated, listener),
  onTrustedImageSendersChanged: (listener) =>
    subscribe(
      MAIL_TRUSTED_IMAGE_SENDERS_CHANGED_CHANNEL,
      GmailTrustedImageSendersReply,
      listener
    ),
  openAttachmentPreview: (request) =>
    ipcRenderer.invoke(MAIL_OPEN_ATTACHMENT_PREVIEW_CHANNEL, request),
  prepareOutgoingAttachments: (request) =>
    ipcRenderer.invoke(MAIL_PREPARE_OUTGOING_ATTACHMENTS_CHANNEL, request),
  saveAttachment: (request) =>
    ipcRenderer.invoke(MAIL_SAVE_ATTACHMENT_CHANNEL, request),
  saveMailDraft: (request) =>
    ipcRenderer.invoke(MAIL_SAVE_DRAFT_CHANNEL, request),
  searchMail: (request) =>
    ipcRenderer.invoke(MAIL_SEARCH_THREADS_CHANNEL, request),
  sendMessage: (request) =>
    ipcRenderer.invoke(MAIL_SEND_MESSAGE_CHANNEL, request),
  sendThreadMessage: (request) =>
    ipcRenderer.invoke(MAIL_SEND_THREAD_MESSAGE_CHANNEL, request),
  setThreadLabel: (request) =>
    ipcRenderer.invoke(MAIL_SET_THREAD_LABEL_CHANNEL, request),
  setThreadReadState: (request) =>
    ipcRenderer.invoke(MAIL_SET_THREAD_READ_CHANNEL, request),
  syncGmailLabels: (request) =>
    ipcRenderer.invoke(MAIL_SYNC_LABELS_CHANNEL, request),
  trashThread: (request) =>
    ipcRenderer.invoke(MAIL_TRASH_THREAD_CHANNEL, request),
  trustImageSender: (request) =>
    ipcRenderer.invoke(MAIL_TRUST_IMAGE_SENDER_CHANNEL, request),
};
