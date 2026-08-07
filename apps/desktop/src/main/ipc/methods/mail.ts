import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  MAIL_LIST_CACHED_THREAD_PAGE_CHANNEL,
  MAIL_LIST_LABELS_CHANNEL,
  MAIL_LIST_TRUSTED_IMAGE_SENDERS_CHANNEL,
  MAIL_LOAD_THREAD_CHANNEL,
  MAIL_LOAD_THREAD_PAGE_CHANNEL,
  MAIL_SET_THREAD_READ_CHANNEL,
  MAIL_SYNC_LABELS_CHANNEL,
  MAIL_SYNC_STATUS_CHANNEL,
  MAIL_TRASH_THREAD_CHANNEL,
  MAIL_TRUST_IMAGE_SENDER_CHANNEL,
} from "../../../shared/ipc/channels";
import {
  GmailCachedThreadPageReply,
  GmailCachedThreadPageRequest,
  GmailLabelCatalogReply,
  GmailLabelCatalogRequest,
  GmailSyncStatus,
  GmailThreadMutationReply,
  GmailThreadPageReply,
  GmailThreadPageRequest,
  GmailThreadReadStateRequest,
  GmailThreadReply,
  GmailThreadRequest,
  GmailTrustedImageSenderRequest,
  GmailTrustedImageSendersReply,
} from "../../../shared/ipc/mail";
import {
  getMailSyncStatus,
  listCachedThreadPage,
  listGmailLabelCatalog,
  loadFullThread,
  loadThreadPage,
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

export const getSyncStatus = makeIpcMethod({
  channel: MAIL_SYNC_STATUS_CHANNEL,
  handler: () => Effect.sync(getMailSyncStatus),
  payload: Schema.Void,
  result: GmailSyncStatus,
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

export const loadPage = makeIpcMethod({
  channel: MAIL_LOAD_THREAD_PAGE_CHANNEL,
  handler: (request) =>
    toIpcReply(loadThreadPage(request), "Could not load email"),
  payload: GmailThreadPageRequest,
  result: GmailThreadPageReply,
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
