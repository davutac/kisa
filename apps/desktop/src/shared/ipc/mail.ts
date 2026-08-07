import * as Schema from "effect/Schema";

import { IpcReply } from "./reply";

export const GmailAttachmentSummary = Schema.Struct({
  attachmentId: Schema.optional(Schema.String),
  filename: Schema.String,
  mediaType: Schema.String,
  messageId: Schema.String,
  size: Schema.Number,
});
export type GmailAttachmentSummary = typeof GmailAttachmentSummary.Type;

export const GmailThreadSummary = Schema.Struct({
  accountId: Schema.String,
  attachments: Schema.Array(GmailAttachmentSummary),
  from: Schema.String,
  hasAttachments: Schema.Boolean,
  isUnread: Schema.Boolean,
  labels: Schema.Array(Schema.String),
  latestAt: Schema.Number,
  messageCount: Schema.Number,
  snippet: Schema.String,
  subject: Schema.String,
  threadId: Schema.String,
});
export type GmailThreadSummary = typeof GmailThreadSummary.Type;

export const GmailMessageBody = Schema.Struct({
  html: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
});
export type GmailMessageBody = typeof GmailMessageBody.Type;

export const GmailSenderBrand = Schema.Struct({
  domain: Schema.String,
  imageDataUrl: Schema.String,
  source: Schema.Literal("bimi"),
});
export type GmailSenderBrand = typeof GmailSenderBrand.Type;

export const GmailThreadMessage = Schema.Struct({
  attachments: Schema.Array(GmailAttachmentSummary),
  bcc: Schema.optional(Schema.String),
  body: GmailMessageBody,
  cc: Schema.optional(Schema.String),
  from: Schema.String,
  id: Schema.String,
  labelIds: Schema.Array(Schema.String),
  replyTo: Schema.optional(Schema.String),
  senderBrand: Schema.optional(GmailSenderBrand),
  sentAt: Schema.Number,
  snippet: Schema.String,
  subject: Schema.String,
  to: Schema.optional(Schema.String),
});
export type GmailThreadMessage = typeof GmailThreadMessage.Type;

export const GmailThread = Schema.Struct({
  accountId: Schema.String,
  labels: Schema.Array(Schema.String),
  messages: Schema.Array(GmailThreadMessage),
  subject: Schema.String,
  threadId: Schema.String,
});
export type GmailThread = typeof GmailThread.Type;

export const GmailLabelSummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** Gmail's own wording: "system" for its labels, "user" for the rest. */
  type: Schema.optional(Schema.String),
});
export type GmailLabelSummary = typeof GmailLabelSummary.Type;

export const GmailLabelCatalog = Schema.Struct({
  labels: Schema.Array(GmailLabelSummary),
  syncedAt: Schema.optional(Schema.Number),
});
export type GmailLabelCatalog = typeof GmailLabelCatalog.Type;

export const GmailLabelCatalogRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
});
export type GmailLabelCatalogRequest = typeof GmailLabelCatalogRequest.Type;

export const GmailThreadRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  threadId: Schema.NonEmptyString,
});
export type GmailThreadRequest = typeof GmailThreadRequest.Type;

export const GmailThreadReadStateRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  /** The state to move to, not the state the thread is in. */
  isUnread: Schema.Boolean,
  threadId: Schema.NonEmptyString,
});
export type GmailThreadReadStateRequest =
  typeof GmailThreadReadStateRequest.Type;

/** A sender whose remote images the account has agreed to load. */
export const GmailTrustedImageSender = Schema.Struct({
  accountId: Schema.String,
  senderEmail: Schema.String,
});
export type GmailTrustedImageSender = typeof GmailTrustedImageSender.Type;

export const GmailTrustedImageSenderRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  senderEmail: Schema.NonEmptyString,
});
export type GmailTrustedImageSenderRequest =
  typeof GmailTrustedImageSenderRequest.Type;

export const GmailThreadsChanged = Schema.Struct({
  accountId: Schema.String,
});
export type GmailThreadsChanged = typeof GmailThreadsChanged.Type;

export const GmailThreadPageRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  pageToken: Schema.optional(Schema.NonEmptyString),
  query: Schema.optional(Schema.NonEmptyString),
});
export type GmailThreadPageRequest = typeof GmailThreadPageRequest.Type;

export const GmailThreadPage = Schema.Struct({
  nextPageToken: Schema.optional(Schema.String),
  threads: Schema.Array(GmailThreadSummary),
});
export type GmailThreadPage = typeof GmailThreadPage.Type;

export const GmailThreadCursor = Schema.Struct({
  accountId: Schema.NonEmptyString,
  latestAt: Schema.Int,
  threadId: Schema.NonEmptyString,
});
export type GmailThreadCursor = typeof GmailThreadCursor.Type;

export const GmailCachedThreadPageRequest = Schema.Struct({
  accountIds: Schema.Array(Schema.NonEmptyString),
  cursor: Schema.optional(GmailThreadCursor),
  unreadOnly: Schema.optional(Schema.Boolean),
});
export type GmailCachedThreadPageRequest =
  typeof GmailCachedThreadPageRequest.Type;

export const GmailCachedThreadPage = Schema.Struct({
  nextCursor: Schema.optional(GmailThreadCursor),
  threads: Schema.Array(GmailThreadSummary),
});
export type GmailCachedThreadPage = typeof GmailCachedThreadPage.Type;

export const GmailSyncStatus = Schema.Struct({
  accountIds: Schema.Array(Schema.String),
});
export type GmailSyncStatus = typeof GmailSyncStatus.Type;

/**
 * `queued` is renderer-only and never persisted: it means the account is
 * waiting behind another account's index. Whether it is queued is a fact about
 * the current process, not about the account, so it must not survive a restart.
 */
export const GmailIndexStatus = Schema.Literals([
  "complete",
  "failed",
  "idle",
  "paused",
  "queued",
  "running",
]);
export type GmailIndexStatus = typeof GmailIndexStatus.Type;

/**
 * Progress for the full-account mail index. This rides its own channel rather
 * than the threads-changed event, which triggers a first-page reload in the
 * renderer — at one update per indexed page that would rebuild the list
 * continuously for the length of the backfill.
 */
export const GmailIndexProgress = Schema.Struct({
  accountId: Schema.NonEmptyString,
  error: Schema.optional(Schema.String),
  estimatedThreads: Schema.optional(Schema.Int),
  indexedMessages: Schema.Int,
  indexedThreads: Schema.Int,
  /** Oldest message indexed so far — "indexed back to March 2019". */
  oldestIndexedAt: Schema.optional(Schema.Int),
  status: GmailIndexStatus,
});
export type GmailIndexProgress = typeof GmailIndexProgress.Type;

export const GmailIndexProgressList = Schema.Struct({
  accounts: Schema.Array(GmailIndexProgress),
});
export type GmailIndexProgressList = typeof GmailIndexProgressList.Type;

export const GmailLabelCatalogReply = IpcReply(GmailLabelCatalog);
export type GmailLabelCatalogReply = typeof GmailLabelCatalogReply.Type;

export const GmailCachedThreadPageReply = IpcReply(GmailCachedThreadPage);
export type GmailCachedThreadPageReply = typeof GmailCachedThreadPageReply.Type;

export const GmailThreadReply = IpcReply(GmailThread);
export type GmailThreadReply = typeof GmailThreadReply.Type;

export const GmailThreadPageReply = IpcReply(GmailThreadPage);
export type GmailThreadPageReply = typeof GmailThreadPageReply.Type;

export const GmailTrustedImageSendersReply = IpcReply(
  Schema.Array(GmailTrustedImageSender)
);
export type GmailTrustedImageSendersReply =
  typeof GmailTrustedImageSendersReply.Type;

export const GmailThreadMutationReply = IpcReply(Schema.Void);
export type GmailThreadMutationReply = typeof GmailThreadMutationReply.Type;
