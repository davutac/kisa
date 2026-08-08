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

export const GmailThreadUpdated = GmailThread;
export type GmailThreadUpdated = typeof GmailThreadUpdated.Type;

export const GmailThreadListChange = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("upsert"), thread: GmailThreadSummary }),
  Schema.Struct({
    accountId: Schema.String,
    kind: Schema.Literal("remove"),
    threadId: Schema.String,
  }),
  Schema.Struct({ accountId: Schema.String, kind: Schema.Literal("reload") }),
]);
export type GmailThreadListChange = typeof GmailThreadListChange.Type;

/** Ordered cached-list changes produced by one completed mail operation. */
export const GmailThreadListUpdated = Schema.Struct({
  changes: Schema.Array(GmailThreadListChange),
});
export type GmailThreadListUpdated = typeof GmailThreadListUpdated.Type;

export const GmailThreadReadStateRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  /** The state to move to, not the state the thread is in. */
  isUnread: Schema.Boolean,
  threadId: Schema.NonEmptyString,
});
export type GmailThreadReadStateRequest =
  typeof GmailThreadReadStateRequest.Type;

export const GmailThreadMessageAction = Schema.Literals([
  "forward",
  "reply",
  "reply-all",
]);
export type GmailThreadMessageAction = typeof GmailThreadMessageAction.Type;

export const GmailThreadMessageSendRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  action: GmailThreadMessageAction,
  bcc: Schema.Array(Schema.NonEmptyString),
  body: Schema.Struct({
    html: Schema.String,
    text: Schema.String,
  }),
  cc: Schema.Array(Schema.NonEmptyString),
  messageId: Schema.NonEmptyString,
  threadId: Schema.NonEmptyString,
  to: Schema.Array(Schema.NonEmptyString),
});
export type GmailThreadMessageSendRequest =
  typeof GmailThreadMessageSendRequest.Type;

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
 * The operators the search palette turns into pills, spelled the way Gmail
 * spells them so a query typed out of habit lands where it is expected.
 */
export const GmailSearchFilterField = Schema.Literals([
  "from",
  "has",
  "is",
  "subject",
  "to",
]);
export type GmailSearchFilterField = typeof GmailSearchFilterField.Type;

export const GmailSearchFilter = Schema.Struct({
  field: GmailSearchFilterField,
  value: Schema.NonEmptyString,
});
export type GmailSearchFilter = typeof GmailSearchFilter.Type;

export const GmailSearchRequest = Schema.Struct({
  accountIds: Schema.Array(Schema.NonEmptyString),
  filters: Schema.optional(Schema.Array(GmailSearchFilter)),
  limit: Schema.optional(Schema.Int),
  text: Schema.optional(Schema.String),
});
export type GmailSearchRequest = typeof GmailSearchRequest.Type;

export const GmailSearchResults = Schema.Struct({
  /** More matched than were returned, so the list is a top slice. */
  hasMore: Schema.Boolean,
  threads: Schema.Array(GmailThreadSummary),
});
export type GmailSearchResults = typeof GmailSearchResults.Type;

export const GmailSenderSuggestion = Schema.Struct({
  address: Schema.String,
  messageCount: Schema.Int,
  name: Schema.optional(Schema.String),
});
export type GmailSenderSuggestion = typeof GmailSenderSuggestion.Type;

/** Which side of a message to draw addresses from, or both for composing. */
export const GmailAddressRole = Schema.Literals([
  "correspondent",
  "recipient",
  "sender",
]);
export type GmailAddressRole = typeof GmailAddressRole.Type;

export const GmailSenderSuggestionRequest = Schema.Struct({
  accountIds: Schema.Array(Schema.NonEmptyString),
  limit: Schema.optional(Schema.Int),
  query: Schema.optional(Schema.String),
  role: Schema.optional(GmailAddressRole),
});
export type GmailSenderSuggestionRequest =
  typeof GmailSenderSuggestionRequest.Type;

export const GmailSenderSuggestions = Schema.Struct({
  senders: Schema.Array(GmailSenderSuggestion),
});
export type GmailSenderSuggestions = typeof GmailSenderSuggestions.Type;

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

export const GmailSearchResultsReply = IpcReply(GmailSearchResults);
export type GmailSearchResultsReply = typeof GmailSearchResultsReply.Type;

export const GmailSenderSuggestionsReply = IpcReply(GmailSenderSuggestions);
export type GmailSenderSuggestionsReply =
  typeof GmailSenderSuggestionsReply.Type;

export const GmailTrustedImageSendersReply = IpcReply(
  Schema.Array(GmailTrustedImageSender)
);
export type GmailTrustedImageSendersReply =
  typeof GmailTrustedImageSendersReply.Type;

export const GmailThreadMutationReply = IpcReply(Schema.Void);
export type GmailThreadMutationReply = typeof GmailThreadMutationReply.Type;

export const GmailThreadMessageSendReply = IpcReply(Schema.Void);
export type GmailThreadMessageSendReply =
  typeof GmailThreadMessageSendReply.Type;
