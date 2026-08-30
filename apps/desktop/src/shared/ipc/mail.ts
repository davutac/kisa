import * as Schema from "effect/Schema";

import { EmailSignatureBody } from "../email-signature";
import { MAX_GMAIL_SUBJECT_LENGTH } from "../gmail-subject";
import { IpcReply } from "./reply";

export const GmailAttachmentSummary = Schema.Struct({
  attachmentId: Schema.optional(Schema.String),
  filename: Schema.String,
  mediaType: Schema.String,
  messageId: Schema.String,
  size: Schema.Finite,
});
export type GmailAttachmentSummary = typeof GmailAttachmentSummary.Type;

export const GmailAttachmentRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  attachmentId: Schema.NonEmptyString,
  messageId: Schema.NonEmptyString,
});
export type GmailAttachmentRequest = typeof GmailAttachmentRequest.Type;

export const GmailAttachmentSaveOutcome = Schema.Literals([
  "cancelled",
  "saved",
]);
export type GmailAttachmentSaveOutcome = typeof GmailAttachmentSaveOutcome.Type;

export const GmailAttachmentPreview = Schema.Struct({
  bytes: Schema.Uint8Array,
  filename: Schema.NonEmptyString,
  kind: Schema.Literals(["image", "pdf"]),
  mediaType: Schema.NonEmptyString,
});
export type GmailAttachmentPreview = typeof GmailAttachmentPreview.Type;

export const GmailThreadSummary = Schema.Struct({
  accountId: Schema.String,
  attachments: Schema.Array(GmailAttachmentSummary),
  from: Schema.String,
  hasAttachments: Schema.Boolean,
  isUnread: Schema.Boolean,
  labels: Schema.Array(Schema.String),
  latestAt: Schema.Finite,
  messageCount: Schema.Finite,
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
  sentAt: Schema.Finite,
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

export const GmailLabelColor = Schema.Struct({
  background: Schema.String,
  text: Schema.String,
});
export type GmailLabelColor = typeof GmailLabelColor.Type;

/** Gmail's accepted label colors, ordered as displayed in the 12-column picker. */
export const GMAIL_LABEL_COLOR_VALUES = [
  "#000000",
  "#434343",
  "#464646",
  "#666666",
  "#999999",
  "#c2c2c2",
  "#cccccc",
  "#e7e7e7",
  "#efefef",
  "#f3f3f3",
  "#ffffff",
  "#ebdbde",
  "#f6c5be",
  "#ffe6c7",
  "#ffdeb5",
  "#fef1d1",
  "#fdedc1",
  "#c6f3de",
  "#c9daf8",
  "#e3d7ff",
  "#e4d7f5",
  "#fcdee8",
  "#fbc8d9",
  "#fbd3e0",
  "#f2b2a8",
  "#ffc8af",
  "#ffd6a2",
  "#fce8b3",
  "#b3efd3",
  "#b9e4d0",
  "#a0eac9",
  "#b6cff5",
  "#a4c2f4",
  "#b99aff",
  "#d0bcf1",
  "#f7a7c0",
  "#efa093",
  "#ffbc6b",
  "#fcda83",
  "#fad165",
  "#fbe983",
  "#a2dcc1",
  "#89d3b2",
  "#98d7e4",
  "#b694e8",
  "#f691b3",
  "#f691b2",
  "#cca6ac",
  "#e66550",
  "#ff7537",
  "#ffad47",
  "#ffad46",
  "#f2c960",
  "#68dfa9",
  "#6d9eeb",
  "#4986e7",
  "#4a86e8",
  "#8e63ce",
  "#a479e2",
  "#e07798",
  "#fb4c2f",
  "#cc3a21",
  "#cf8933",
  "#eaa041",
  "#d5ae49",
  "#43d692",
  "#42d692",
  "#44b984",
  "#3dc789",
  "#2da2bb",
  "#3c78d8",
  "#b65775",
  "#ac2b16",
  "#a46a21",
  "#aa8831",
  "#2a9c68",
  "#16a765",
  "#149e60",
  "#16a766",
  "#285bac",
  "#3d188e",
  "#653e9b",
  "#994a64",
  "#83334c",
  "#8a1c0a",
  "#822111",
  "#7a2e0b",
  "#7a4706",
  "#684e07",
  "#0b804b",
  "#1a764d",
  "#0d3472",
  "#1c4587",
  "#41236d",
  "#711a36",
  "#662e37",
  "#594c05",
  "#094228",
  "#0b4f30",
  "#076239",
  "#04502e",
  "#0d3b44",
] as const;

export const GmailLabelInputColor = Schema.Struct({
  background: Schema.Literals(GMAIL_LABEL_COLOR_VALUES),
  text: Schema.Literals(GMAIL_LABEL_COLOR_VALUES),
});
export type GmailLabelInputColor = typeof GmailLabelInputColor.Type;

export const GmailLabelSummary = Schema.Struct({
  color: Schema.optional(GmailLabelColor),
  id: Schema.String,
  name: Schema.String,
  threadCount: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  /** Gmail's own wording: "system" for its labels, "user" for the rest. */
  type: Schema.optional(Schema.String),
});
export type GmailLabelSummary = typeof GmailLabelSummary.Type;

export const GmailLabelCatalog = Schema.Struct({
  labels: Schema.Array(GmailLabelSummary),
  syncedAt: Schema.optional(Schema.Finite),
});
export type GmailLabelCatalog = typeof GmailLabelCatalog.Type;

export const GmailLabelCatalogChanged = Schema.Struct({
  accountId: Schema.NonEmptyString,
});
export type GmailLabelCatalogChanged = typeof GmailLabelCatalogChanged.Type;

export const GmailLabelCatalogRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
});
export type GmailLabelCatalogRequest = typeof GmailLabelCatalogRequest.Type;

export const GmailLabelCreateRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  color: Schema.optional(GmailLabelInputColor),
  name: Schema.NonEmptyString,
});
export type GmailLabelCreateRequest = typeof GmailLabelCreateRequest.Type;

export const GmailLabelDeleteRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  labelId: Schema.NonEmptyString,
});
export type GmailLabelDeleteRequest = typeof GmailLabelDeleteRequest.Type;

export const GmailLabelUpdateRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  color: Schema.optional(GmailLabelInputColor),
  labelId: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
});
export type GmailLabelUpdateRequest = typeof GmailLabelUpdateRequest.Type;

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

export const GmailThreadLabelRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  applied: Schema.Boolean,
  labelId: Schema.NonEmptyString,
  threadId: Schema.NonEmptyString,
});
export type GmailThreadLabelRequest = typeof GmailThreadLabelRequest.Type;

export const GmailThreadReadStateRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  /** The state to move to, not the state the thread is in. */
  isUnread: Schema.Boolean,
  threadId: Schema.NonEmptyString,
});
export type GmailThreadReadStateRequest =
  typeof GmailThreadReadStateRequest.Type;

export const GmailBulkThreadMutationOperation = Schema.Union([
  Schema.Struct({
    isUnread: Schema.Boolean,
    kind: Schema.Literal("setReadState"),
  }),
  Schema.Struct({
    applied: Schema.Boolean,
    kind: Schema.Literal("setLabel"),
    labelId: Schema.NonEmptyString,
  }),
  Schema.Struct({ kind: Schema.Literal("trash") }),
  Schema.Struct({ kind: Schema.Literal("moveToInbox") }),
  Schema.Struct({ kind: Schema.Literal("moveToSpam") }),
  Schema.Struct({ kind: Schema.Literal("deleteForever") }),
]);
export type GmailBulkThreadMutationOperation =
  typeof GmailBulkThreadMutationOperation.Type;

export const GmailBulkThreadMutationRequest = Schema.Struct({
  operation: GmailBulkThreadMutationOperation,
  threads: Schema.Array(GmailThreadRequest),
});
export type GmailBulkThreadMutationRequest =
  typeof GmailBulkThreadMutationRequest.Type;

export const GmailBulkThreadMutationResult = Schema.Struct({
  failed: Schema.Array(GmailThreadRequest),
  succeeded: Schema.Array(GmailThreadRequest),
});
export type GmailBulkThreadMutationResult =
  typeof GmailBulkThreadMutationResult.Type;

export const GmailOutgoingAttachmentCapability = Schema.Struct({
  capability: Schema.NonEmptyString,
});
export type GmailOutgoingAttachmentCapability =
  typeof GmailOutgoingAttachmentCapability.Type;

export const GmailThreadMessageAction = Schema.Literals([
  "forward",
  "reply",
  "reply-all",
]);
export type GmailThreadMessageAction = typeof GmailThreadMessageAction.Type;

export const GmailThreadMessageSendRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  action: GmailThreadMessageAction,
  attachments: Schema.Array(GmailOutgoingAttachmentCapability),
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

export const MAX_GMAIL_ATTACHMENT_BYTES = 25_000_000;

const GmailOutgoingSubject = Schema.String.check(
  Schema.isMaxLength(MAX_GMAIL_SUBJECT_LENGTH)
);

export const GmailOutgoingAttachmentPrepareRequest = Schema.Struct({
  referenceIds: Schema.Array(Schema.NonEmptyString),
});
export type GmailOutgoingAttachmentPrepareRequest =
  typeof GmailOutgoingAttachmentPrepareRequest.Type;

export const GmailOutgoingAttachmentSelectionRequest = Schema.Struct({
  files: Schema.Array(
    Schema.Struct({
      mediaType: Schema.String,
      path: Schema.NonEmptyString,
    })
  ),
});
export type GmailOutgoingAttachmentSelectionRequest =
  typeof GmailOutgoingAttachmentSelectionRequest.Type;

export const GmailMessageSendRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  attachments: Schema.Array(GmailOutgoingAttachmentCapability),
  bcc: Schema.Array(Schema.NonEmptyString),
  body: Schema.Struct({
    html: Schema.String,
    text: Schema.String,
  }),
  cc: Schema.Array(Schema.NonEmptyString),
  subject: GmailOutgoingSubject,
  to: Schema.Array(Schema.NonEmptyString),
});
export type GmailMessageSendRequest = typeof GmailMessageSendRequest.Type;

export const MailDraftKind = Schema.Literals([
  "forward",
  "new",
  "reply",
  "reply-all",
]);
export type MailDraftKind = typeof MailDraftKind.Type;

export const MailDraftAttachment = Schema.Struct({
  filename: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  mediaType: Schema.NonEmptyString,
  referenceId: Schema.NonEmptyString,
  size: Schema.Finite,
});
export type MailDraftAttachment = typeof MailDraftAttachment.Type;

export const MailDraftSignature = Schema.Struct({
  accountId: Schema.NonEmptyString,
  body: EmailSignatureBody,
});
export type MailDraftSignature = typeof MailDraftSignature.Type;

export const MailDraftInput = Schema.Struct({
  accountId: Schema.optional(Schema.NonEmptyString),
  attachments: Schema.Array(MailDraftAttachment),
  bcc: Schema.Array(Schema.NonEmptyString),
  body: Schema.Struct({ html: Schema.String, text: Schema.String }),
  cc: Schema.Array(Schema.NonEmptyString),
  id: Schema.NonEmptyString,
  kind: MailDraftKind,
  messageId: Schema.optional(Schema.NonEmptyString),
  signature: Schema.optional(MailDraftSignature),
  subject: Schema.String,
  threadId: Schema.optional(Schema.NonEmptyString),
  to: Schema.Array(Schema.NonEmptyString),
});
export type MailDraftInput = typeof MailDraftInput.Type;

export const MailDraft = Schema.Struct({
  ...MailDraftInput.fields,
  createdAt: Schema.Finite,
  updatedAt: Schema.Finite,
});
export type MailDraft = typeof MailDraft.Type;

export const MailDraftListRequest = Schema.Struct({
  accountIds: Schema.Array(Schema.NonEmptyString),
});
export type MailDraftListRequest = typeof MailDraftListRequest.Type;

export const MailDraftDiscardRequest = Schema.Struct({
  accountId: Schema.optional(Schema.NonEmptyString),
  draftId: Schema.NonEmptyString,
});
export type MailDraftDiscardRequest = typeof MailDraftDiscardRequest.Type;

export const MailDraftChanged = Schema.Union([
  Schema.Struct({ draft: MailDraft, kind: Schema.Literal("upsert") }),
  Schema.Struct({
    accountId: Schema.optional(Schema.NonEmptyString),
    draftId: Schema.NonEmptyString,
    kind: Schema.Literal("remove"),
    threadId: Schema.optional(Schema.NonEmptyString),
  }),
]);
export type MailDraftChanged = typeof MailDraftChanged.Type;

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

export const GmailMailbox = Schema.Literals(["inbox", "sent", "spam", "trash"]);
export type GmailMailbox = typeof GmailMailbox.Type;

export const GmailCachedThreadPageRequest = Schema.Struct({
  accountIds: Schema.Array(Schema.NonEmptyString),
  cursor: Schema.optional(GmailThreadCursor),
  labelNames: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  mailbox: Schema.optional(GmailMailbox),
  unreadOnly: Schema.optional(Schema.Boolean),
});
export type GmailCachedThreadPageRequest =
  typeof GmailCachedThreadPageRequest.Type;

export const GmailSpamStatusRequest = Schema.Struct({
  accountIds: Schema.Array(Schema.NonEmptyString),
});
export type GmailSpamStatusRequest = typeof GmailSpamStatusRequest.Type;

export const GmailReindexRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
});
export type GmailReindexRequest = typeof GmailReindexRequest.Type;

export const GmailSpamStatus = Schema.Struct({ hasUnreadSpam: Schema.Boolean });
export type GmailSpamStatus = typeof GmailSpamStatus.Type;

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
 * The operators inline search turns into pills, spelled the way Gmail
 * spells them so a query typed out of habit lands where it is expected.
 */
export const GmailSearchFilterField = Schema.Literals([
  "from",
  "has",
  "is",
  "label",
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

export const GmailIndexStatus = Schema.Literals([
  "complete",
  "failed",
  "idle",
  "paused",
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

export const GmailLabelCreateReply = IpcReply(GmailLabelSummary);
export type GmailLabelCreateReply = typeof GmailLabelCreateReply.Type;

export const GmailLabelDeleteReply = IpcReply(Schema.Void);
export type GmailLabelDeleteReply = typeof GmailLabelDeleteReply.Type;

export const GmailLabelUpdateReply = IpcReply(GmailLabelSummary);
export type GmailLabelUpdateReply = typeof GmailLabelUpdateReply.Type;

export const GmailCachedThreadPageReply = IpcReply(GmailCachedThreadPage);
export type GmailCachedThreadPageReply = typeof GmailCachedThreadPageReply.Type;

export const GmailThreadReply = IpcReply(GmailThread);
export type GmailThreadReply = typeof GmailThreadReply.Type;
export const GmailAttachmentActionReply = IpcReply(Schema.Void);
export type GmailAttachmentActionReply = typeof GmailAttachmentActionReply.Type;
export const GmailAttachmentSaveReply = IpcReply(GmailAttachmentSaveOutcome);
export type GmailAttachmentSaveReply = typeof GmailAttachmentSaveReply.Type;
export const GmailAttachmentPreviewReply = IpcReply(GmailAttachmentPreview);
export type GmailAttachmentPreviewReply =
  typeof GmailAttachmentPreviewReply.Type;

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

export const GmailBulkThreadMutationReply = IpcReply(
  GmailBulkThreadMutationResult
);
export type GmailBulkThreadMutationReply =
  typeof GmailBulkThreadMutationReply.Type;

export const GmailSpamStatusReply = IpcReply(GmailSpamStatus);
export type GmailSpamStatusReply = typeof GmailSpamStatusReply.Type;

export const GmailReindexReply = IpcReply(Schema.Void);
export type GmailReindexReply = typeof GmailReindexReply.Type;

export const GmailThreadMessageSendReply = IpcReply(Schema.Void);
export type GmailThreadMessageSendReply =
  typeof GmailThreadMessageSendReply.Type;

export const GmailMessageSendReply = IpcReply(Schema.Void);
export type GmailMessageSendReply = typeof GmailMessageSendReply.Type;

export const GmailOutgoingAttachmentPrepareReply = IpcReply(
  Schema.Array(GmailOutgoingAttachmentCapability)
);
export type GmailOutgoingAttachmentPrepareReply =
  typeof GmailOutgoingAttachmentPrepareReply.Type;

export const GmailOutgoingAttachmentSelectionReply = IpcReply(
  Schema.Array(MailDraftAttachment)
);
export type GmailOutgoingAttachmentSelectionReply =
  typeof GmailOutgoingAttachmentSelectionReply.Type;
export const MailDraftReply = IpcReply(MailDraft);
export type MailDraftReply = typeof MailDraftReply.Type;
export const MailDraftListReply = IpcReply(Schema.Array(MailDraft));
export type MailDraftListReply = typeof MailDraftListReply.Type;
export const MailDraftLoadReply = IpcReply(Schema.NullOr(MailDraft));
export type MailDraftLoadReply = typeof MailDraftLoadReply.Type;
export const MailDraftDiscardReply = IpcReply(Schema.Void);
export type MailDraftDiscardReply = typeof MailDraftDiscardReply.Type;
