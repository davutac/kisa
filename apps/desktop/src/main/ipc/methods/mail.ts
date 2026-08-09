import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { BrowserWindow } from "electron";

import {
  ATTACHMENT_PREVIEW_LOAD_CHANNEL,
  ATTACHMENT_PREVIEW_SAVE_CHANNEL,
  MAIL_INDEX_PROGRESS_CHANNEL,
  MAIL_LIST_CACHED_THREAD_PAGE_CHANNEL,
  MAIL_LIST_LABELS_CHANNEL,
  MAIL_LIST_SENDERS_CHANNEL,
  MAIL_LIST_TRUSTED_IMAGE_SENDERS_CHANNEL,
  MAIL_LOAD_THREAD_CHANNEL,
  MAIL_OPEN_ATTACHMENT_PREVIEW_CHANNEL,
  MAIL_SAVE_ATTACHMENT_CHANNEL,
  MAIL_SEARCH_THREADS_CHANNEL,
  MAIL_SEND_MESSAGE_CHANNEL,
  MAIL_SEND_THREAD_MESSAGE_CHANNEL,
  MAIL_SET_THREAD_READ_CHANNEL,
  MAIL_SYNC_LABELS_CHANNEL,
  MAIL_SYNC_STATUS_CHANNEL,
  MAIL_TRASH_THREAD_CHANNEL,
  MAIL_TRUST_IMAGE_SENDER_CHANNEL,
} from "../../../shared/ipc/channels";
import {
  GmailAttachmentActionReply,
  GmailAttachmentPreviewReply,
  GmailAttachmentRequest,
  GmailAttachmentSaveReply,
  GmailCachedThreadPageReply,
  GmailCachedThreadPageRequest,
  GmailIndexProgressList,
  GmailLabelCatalogReply,
  GmailLabelCatalogRequest,
  GmailMessageSendReply,
  GmailMessageSendRequest,
  GmailSearchRequest,
  GmailSearchResultsReply,
  GmailSenderSuggestionRequest,
  GmailSenderSuggestionsReply,
  GmailSyncStatus,
  GmailThreadMutationReply,
  GmailThreadMessageSendReply,
  GmailThreadMessageSendRequest,
  GmailThreadReadStateRequest,
  GmailThreadReply,
  GmailThreadRequest,
  GmailTrustedImageSenderRequest,
  GmailTrustedImageSendersReply,
} from "../../../shared/ipc/mail";
import {
  loadAttachmentPreview as loadAttachmentPreviewAction,
  openAttachmentPreview as openAttachmentPreviewAction,
  saveAttachment as saveAttachmentAction,
  saveAttachmentPreview as saveAttachmentPreviewAction,
} from "../../mail/attachment-actions";
import { getMailIndexProgress } from "../../mail/mail-backfill";
import {
  listIndexedSenders,
  searchIndexedThreads,
} from "../../mail/mail-search";
import {
  getMailSyncStatus,
  listCachedThreadPage,
  listGmailLabelCatalog,
  loadFullThread,
  sendNewMessage,
  sendThreadMessage,
  setThreadReadState,
  syncGmailLabelCatalog,
  trashThread,
} from "../../mail/mail-sync";
import {
  listTrustedImageSenders,
  trustImageSender,
} from "../../mail/trusted-image-senders";
import { makeIpcMethod } from "../desktop-ipc";
import { toIpcReply } from "../reply";

export const openAttachmentPreview = makeIpcMethod({
  channel: MAIL_OPEN_ATTACHMENT_PREVIEW_CHANNEL,
  handler: (request) =>
    toIpcReply(
      openAttachmentPreviewAction(request),
      "Could not open attachment preview"
    ),
  payload: GmailAttachmentRequest,
  result: GmailAttachmentActionReply,
});

export const saveAttachment = makeIpcMethod({
  channel: MAIL_SAVE_ATTACHMENT_CHANNEL,
  handler: (request, event) => {
    const window =
      event === undefined
        ? undefined
        : BrowserWindow.fromWebContents(event.sender);

    return window === undefined || window === null
      ? Effect.succeed({
          error: "Could not open the save dialog",
          ok: false as const,
        })
      : toIpcReply(
          saveAttachmentAction(request, window),
          "Could not save attachment"
        );
  },
  payload: GmailAttachmentRequest,
  result: GmailAttachmentSaveReply,
});

export const loadAttachmentPreview = makeIpcMethod({
  channel: ATTACHMENT_PREVIEW_LOAD_CHANNEL,
  handler: (_request, event) =>
    event === undefined
      ? Effect.succeed({
          error: "Attachment preview is unavailable",
          ok: false as const,
        })
      : toIpcReply(
          loadAttachmentPreviewAction(event.sender.id),
          "Could not load attachment"
        ),
  payload: Schema.Void,
  result: GmailAttachmentPreviewReply,
});

export const saveAttachmentPreview = makeIpcMethod({
  channel: ATTACHMENT_PREVIEW_SAVE_CHANNEL,
  handler: (_request, event) =>
    event === undefined
      ? Effect.succeed({
          error: "Attachment preview is unavailable",
          ok: false as const,
        })
      : toIpcReply(
          saveAttachmentPreviewAction(event.sender.id),
          "Could not save attachment"
        ),
  payload: Schema.Void,
  result: GmailAttachmentSaveReply,
});

export const getSyncStatus = makeIpcMethod({
  channel: MAIL_SYNC_STATUS_CHANNEL,
  handler: () => Effect.sync(getMailSyncStatus),
  payload: Schema.Void,
  result: GmailSyncStatus,
});

export const getIndexProgress = makeIpcMethod({
  channel: MAIL_INDEX_PROGRESS_CHANNEL,
  handler: () => Effect.sync(() => ({ accounts: getMailIndexProgress() })),
  payload: Schema.Void,
  result: GmailIndexProgressList,
});

export const listCachedPage = makeIpcMethod({
  channel: MAIL_LIST_CACHED_THREAD_PAGE_CHANNEL,
  handler: (request) =>
    toIpcReply(listCachedThreadPage(request), "Could not load email"),
  payload: GmailCachedThreadPageRequest,
  result: GmailCachedThreadPageReply,
});

export const listLabels = makeIpcMethod({
  channel: MAIL_LIST_LABELS_CHANNEL,
  handler: (request) =>
    toIpcReply(listGmailLabelCatalog(request), "Could not load Gmail labels"),
  payload: GmailLabelCatalogRequest,
  result: GmailLabelCatalogReply,
});

export const syncLabels = makeIpcMethod({
  channel: MAIL_SYNC_LABELS_CHANNEL,
  handler: (request) =>
    toIpcReply(syncGmailLabelCatalog(request), "Could not sync Gmail labels"),
  payload: GmailLabelCatalogRequest,
  result: GmailLabelCatalogReply,
});

export const searchThreads = makeIpcMethod({
  channel: MAIL_SEARCH_THREADS_CHANNEL,
  handler: (request) =>
    toIpcReply(searchIndexedThreads(request), "Could not search your email"),
  payload: GmailSearchRequest,
  result: GmailSearchResultsReply,
});

export const listSenders = makeIpcMethod({
  channel: MAIL_LIST_SENDERS_CHANNEL,
  handler: (request) =>
    toIpcReply(listIndexedSenders(request), "Could not load senders"),
  payload: GmailSenderSuggestionRequest,
  result: GmailSenderSuggestionsReply,
});

export const loadThread = makeIpcMethod({
  channel: MAIL_LOAD_THREAD_CHANNEL,
  handler: (request) =>
    toIpcReply(loadFullThread(request), "Could not load email"),
  payload: GmailThreadRequest,
  result: GmailThreadReply,
});

export const setReadState = makeIpcMethod({
  channel: MAIL_SET_THREAD_READ_CHANNEL,
  handler: (request) =>
    toIpcReply(setThreadReadState(request), "Could not update email"),
  payload: GmailThreadReadStateRequest,
  result: GmailThreadMutationReply,
});

export const sendNew = makeIpcMethod({
  channel: MAIL_SEND_MESSAGE_CHANNEL,
  handler: (request) =>
    toIpcReply(sendNewMessage(request), "Could not send message"),
  payload: GmailMessageSendRequest,
  result: GmailMessageSendReply,
});

export const sendThread = makeIpcMethod({
  channel: MAIL_SEND_THREAD_MESSAGE_CHANNEL,
  handler: (request) =>
    toIpcReply(sendThreadMessage(request), "Could not send message"),
  payload: GmailThreadMessageSendRequest,
  result: GmailThreadMessageSendReply,
});

export const trash = makeIpcMethod({
  channel: MAIL_TRASH_THREAD_CHANNEL,
  handler: (request) =>
    toIpcReply(trashThread(request), "Could not move email to trash"),
  payload: GmailThreadRequest,
  result: GmailThreadMutationReply,
});

export const listImageSenders = makeIpcMethod({
  channel: MAIL_LIST_TRUSTED_IMAGE_SENDERS_CHANNEL,
  handler: () =>
    toIpcReply(
      listTrustedImageSenders(),
      "Could not load the senders you trust with images"
    ),
  payload: Schema.Void,
  result: GmailTrustedImageSendersReply,
});

export const trustImages = makeIpcMethod({
  channel: MAIL_TRUST_IMAGE_SENDER_CHANNEL,
  handler: (request) =>
    toIpcReply(trustImageSender(request), "Could not remember this sender"),
  payload: GmailTrustedImageSenderRequest,
  result: GmailTrustedImageSendersReply,
});
