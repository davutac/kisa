import * as Schema from "effect/Schema";

import { EmailSignatureBody } from "../email-signature";
import { MAX_SUBJECT_LENGTH } from "../mail-subject";
import { IpcReply } from "./reply";

export const MailAttachmentSummary = Schema.Struct({
  attachmentId: Schema.optional(Schema.String),
  filename: Schema.String,
  mediaType: Schema.String,
  messageId: Schema.String,
  partId: Schema.optional(Schema.String),
  size: Schema.Finite,
});
export type MailAttachmentSummary = typeof MailAttachmentSummary.Type;

export const MailAttachmentRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  attachmentId: Schema.NonEmptyString,
  messageId: Schema.NonEmptyString,
  partId: Schema.optional(Schema.String),
});
export type MailAttachmentRequest = typeof MailAttachmentRequest.Type;

export const MailAttachmentSaveOutcome = Schema.Literals([
  "cancelled",
  "saved",
]);
export type MailAttachmentSaveOutcome = typeof MailAttachmentSaveOutcome.Type;

export const MailAttachmentPreview = Schema.Struct({
  bytes: Schema.Uint8Array,
  filename: Schema.NonEmptyString,
  kind: Schema.Literals(["image", "pdf"]),
  mediaType: Schema.NonEmptyString,
});
export type MailAttachmentPreview = typeof MailAttachmentPreview.Type;

export const MailThreadSummary = Schema.Struct({
  accountId: Schema.String,
  attachments: Schema.Array(MailAttachmentSummary),
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
export type MailThreadSummary = typeof MailThreadSummary.Type;

export const MessageBody = Schema.Struct({
  html: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
});
export type MessageBody = typeof MessageBody.Type;

export const MailSenderBrand = Schema.Struct({
  domain: Schema.String,
  imageDataUrl: Schema.String,
  source: Schema.Literal("bimi"),
});
export type MailSenderBrand = typeof MailSenderBrand.Type;

export const ThreadMessage = Schema.Struct({
  attachments: Schema.Array(MailAttachmentSummary),
  bcc: Schema.optional(Schema.String),
  body: MessageBody,
  cc: Schema.optional(Schema.String),
  from: Schema.String,
  id: Schema.String,
  labelIds: Schema.Array(Schema.String),
  replyTo: Schema.optional(Schema.String),
  /** Whether Gmail authenticated the domain of `from`. */
  senderAuthenticated: Schema.Boolean,
  senderBrand: Schema.optional(MailSenderBrand),
  sentAt: Schema.Finite,
  snippet: Schema.String,
  subject: Schema.String,
  to: Schema.optional(Schema.String),
});
export type ThreadMessage = typeof ThreadMessage.Type;

export const MailThread = Schema.Struct({
  accountId: Schema.String,
  labels: Schema.Array(Schema.String),
  messages: Schema.Array(ThreadMessage),
  subject: Schema.String,
  threadId: Schema.String,
});
export type MailThread = typeof MailThread.Type;

export const MailLabelColor = Schema.Struct({
  background: Schema.String,
  text: Schema.String,
});
export type MailLabelColor = typeof MailLabelColor.Type;

/** Label colors, from Gmail's palette, ordered as displayed in the 12-column picker. */
export const LABEL_COLOR_VALUES = [
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

export const MailLabelInputColor = Schema.Struct({
  background: Schema.Literals(LABEL_COLOR_VALUES),
  text: Schema.Literals(LABEL_COLOR_VALUES),
});
export type MailLabelInputColor = typeof MailLabelInputColor.Type;

export const MailLabelSummary = Schema.Struct({
  color: Schema.optional(MailLabelColor),
  id: Schema.String,
  name: Schema.String,
  threadCount: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  /** The label's kind: "system" for built-in labels, "user" for the rest. */
  type: Schema.optional(Schema.String),
});
export type MailLabelSummary = typeof MailLabelSummary.Type;

export const MailLabelCatalog = Schema.Struct({
  labels: Schema.Array(MailLabelSummary),
  syncedAt: Schema.optional(Schema.Finite),
});
export type MailLabelCatalog = typeof MailLabelCatalog.Type;

export const MailLabelCatalogChanged = Schema.Struct({
  accountId: Schema.NonEmptyString,
});
export type MailLabelCatalogChanged = typeof MailLabelCatalogChanged.Type;

export const MailLabelCatalogRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
});
export type MailLabelCatalogRequest = typeof MailLabelCatalogRequest.Type;

export const MailLabelCreateRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  color: Schema.optional(MailLabelInputColor),
  name: Schema.NonEmptyString,
});
export type MailLabelCreateRequest = typeof MailLabelCreateRequest.Type;

export const MailLabelDeleteRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  labelId: Schema.NonEmptyString,
});
export type MailLabelDeleteRequest = typeof MailLabelDeleteRequest.Type;

export const MailLabelUpdateRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  color: Schema.optional(MailLabelInputColor),
  labelId: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
});
export type MailLabelUpdateRequest = typeof MailLabelUpdateRequest.Type;

export const MailThreadRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  threadId: Schema.NonEmptyString,
});
export type MailThreadRequest = typeof MailThreadRequest.Type;

export const MailThreadListChange = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("upsert"), thread: MailThreadSummary }),
  Schema.Struct({
    accountId: Schema.String,
    kind: Schema.Literal("remove"),
    threadId: Schema.String,
  }),
]);
export type MailThreadListChange = typeof MailThreadListChange.Type;

/** Ordered cached-list changes produced by one completed mail operation. */
export const MailThreadListUpdated = Schema.Struct({
  changes: Schema.Array(MailThreadListChange),
});
export type MailThreadListUpdated = typeof MailThreadListUpdated.Type;

export const MailThreadLabelRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  applied: Schema.Boolean,
  labelId: Schema.NonEmptyString,
  threadId: Schema.NonEmptyString,
});
export type MailThreadLabelRequest = typeof MailThreadLabelRequest.Type;

export const MailThreadReadStateRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  /** The state to move to, not the state the thread is in. */
  isUnread: Schema.Boolean,
  threadId: Schema.NonEmptyString,
});
export type MailThreadReadStateRequest = typeof MailThreadReadStateRequest.Type;

export const MailBulkThreadMutationOperation = Schema.Union([
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
export type MailBulkThreadMutationOperation =
  typeof MailBulkThreadMutationOperation.Type;

export const MailBulkThreadMutationRequest = Schema.Struct({
  operation: MailBulkThreadMutationOperation,
  threads: Schema.Array(MailThreadRequest),
});
export type MailBulkThreadMutationRequest =
  typeof MailBulkThreadMutationRequest.Type;

export const MailBulkThreadMutationResult = Schema.Struct({
  failed: Schema.Array(MailThreadRequest),
  succeeded: Schema.Array(MailThreadRequest),
});
export type MailBulkThreadMutationResult =
  typeof MailBulkThreadMutationResult.Type;

export const MailOutgoingAttachmentCapability = Schema.Struct({
  capability: Schema.NonEmptyString,
});
export type MailOutgoingAttachmentCapability =
  typeof MailOutgoingAttachmentCapability.Type;

export const MAX_OUTGOING_ATTACHMENT_BYTES = 25_000_000;
export const MAX_OUTGOING_ATTACHMENT_COUNT = 100;

const MailOutgoingAttachmentCapabilities = Schema.Array(
  MailOutgoingAttachmentCapability
).check(Schema.isMaxLength(MAX_OUTGOING_ATTACHMENT_COUNT));

export const MailThreadMessageAction = Schema.Literals([
  "forward",
  "reply",
  "reply-all",
]);
export type MailThreadMessageAction = typeof MailThreadMessageAction.Type;

export const MailThreadMessageSendRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  action: MailThreadMessageAction,
  attachments: MailOutgoingAttachmentCapabilities,
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
export type MailThreadMessageSendRequest =
  typeof MailThreadMessageSendRequest.Type;

export const MailOutgoingSubject = Schema.String.check(
  Schema.isMaxLength(MAX_SUBJECT_LENGTH)
);

export const MailOutgoingInlineContentId = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$/u)
);

export const MailOutgoingAttachmentPrepareRequest = Schema.Struct({
  attachments: Schema.Array(
    Schema.Struct({
      contentId: Schema.optional(MailOutgoingInlineContentId),
      referenceId: Schema.NonEmptyString,
    })
  ).check(Schema.isMaxLength(MAX_OUTGOING_ATTACHMENT_COUNT)),
});
export type MailOutgoingAttachmentPrepareRequest =
  typeof MailOutgoingAttachmentPrepareRequest.Type;

export const MailOutgoingAttachmentSelectionRequest = Schema.Struct({
  files: Schema.Array(
    Schema.Struct({
      mediaType: Schema.String,
      path: Schema.NonEmptyString,
    })
  ).check(Schema.isMaxLength(MAX_OUTGOING_ATTACHMENT_COUNT)),
});
export type MailOutgoingAttachmentSelectionRequest =
  typeof MailOutgoingAttachmentSelectionRequest.Type;

export const MailOutgoingInlineImagePreviewRequest = Schema.Struct({
  referenceId: Schema.NonEmptyString,
});
export type MailOutgoingInlineImagePreviewRequest =
  typeof MailOutgoingInlineImagePreviewRequest.Type;

export const MailOutgoingInlineImagePreview = Schema.Struct({
  bytes: Schema.Uint8Array,
  mediaType: Schema.NonEmptyString,
});
export type MailOutgoingInlineImagePreview =
  typeof MailOutgoingInlineImagePreview.Type;

export const MailMessageSendRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  attachments: MailOutgoingAttachmentCapabilities,
  bcc: Schema.Array(Schema.NonEmptyString),
  body: Schema.Struct({
    html: Schema.String,
    text: Schema.String,
  }),
  cc: Schema.Array(Schema.NonEmptyString),
  subject: MailOutgoingSubject,
  to: Schema.Array(Schema.NonEmptyString),
});
export type MailMessageSendRequest = typeof MailMessageSendRequest.Type;

export const MailDraftKind = Schema.Literals([
  "forward",
  "new",
  "reply",
  "reply-all",
]);
export type MailDraftKind = typeof MailDraftKind.Type;

export const MailDraftAttachment = Schema.Struct({
  contentId: Schema.optional(MailOutgoingInlineContentId),
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
  attachments: Schema.Array(MailDraftAttachment).check(
    Schema.isMaxLength(MAX_OUTGOING_ATTACHMENT_COUNT)
  ),
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
  preserveAttachments: Schema.optional(Schema.Boolean),
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
export const MailTrustedImageSender = Schema.Struct({
  accountId: Schema.String,
  senderEmail: Schema.String,
});
export type MailTrustedImageSender = typeof MailTrustedImageSender.Type;

export const MailTrustedImageSenderRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  senderEmail: Schema.NonEmptyString,
});
export type MailTrustedImageSenderRequest =
  typeof MailTrustedImageSenderRequest.Type;

export const MailThreadCursor = Schema.Struct({
  accountId: Schema.NonEmptyString,
  latestAt: Schema.Int,
  threadId: Schema.NonEmptyString,
});
export type MailThreadCursor = typeof MailThreadCursor.Type;

export const Mailbox = Schema.Literals(["inbox", "sent", "spam", "trash"]);
export type Mailbox = typeof Mailbox.Type;

/**
 * A user label as a place: every conversation carrying it outside Spam and
 * Trash. `label` is the label's name, its full `/`-separated path, matched
 * without regard to case so one place spans accounts.
 */
export const MailboxLabelPlace = Schema.Struct({
  label: Schema.NonEmptyString,
});
export type MailboxLabelPlace = typeof MailboxLabelPlace.Type;

export const isMailboxLabelPlace = Schema.is(MailboxLabelPlace);

/** What a mailbox list shows: a system mailbox or one user label. */
export const MailboxPlace = Schema.Union([Mailbox, MailboxLabelPlace]);
export type MailboxPlace = typeof MailboxPlace.Type;

export const MailCachedThreadPageRequest = Schema.Struct({
  accountIds: Schema.Array(Schema.NonEmptyString),
  cursor: Schema.optional(MailThreadCursor),
  mailbox: Schema.optional(MailboxPlace),
  unreadOnly: Schema.optional(Schema.Boolean),
});
export type MailCachedThreadPageRequest =
  typeof MailCachedThreadPageRequest.Type;

export const MailSpamStatusRequest = Schema.Struct({
  accountIds: Schema.Array(Schema.NonEmptyString),
});
export type MailSpamStatusRequest = typeof MailSpamStatusRequest.Type;

export const MailReindexRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
});
export type MailReindexRequest = typeof MailReindexRequest.Type;

export const MailSpamStatus = Schema.Struct({ hasUnreadSpam: Schema.Boolean });
export type MailSpamStatus = typeof MailSpamStatus.Type;

export const MailCachedThreadPage = Schema.Struct({
  nextCursor: Schema.optional(MailThreadCursor),
  threads: Schema.Array(MailThreadSummary),
});
export type MailCachedThreadPage = typeof MailCachedThreadPage.Type;

export const MailSyncStatus = Schema.Struct({
  accountIds: Schema.Array(Schema.String),
});
export type MailSyncStatus = typeof MailSyncStatus.Type;

/**
 * The operators inline search turns into pills, spelled the way Gmail
 * spells them so a query typed out of habit lands where it is expected.
 */
export const MailSearchFilterField = Schema.Literals([
  "from",
  "has",
  "is",
  "label",
  "subject",
  "to",
]);
export type MailSearchFilterField = typeof MailSearchFilterField.Type;

export const MailSearchFilter = Schema.Struct({
  field: MailSearchFilterField,
  value: Schema.NonEmptyString,
});
export type MailSearchFilter = typeof MailSearchFilter.Type;

export const MailSearchRequest = Schema.Struct({
  accountIds: Schema.Array(Schema.NonEmptyString),
  filters: Schema.optional(Schema.Array(MailSearchFilter)),
  limit: Schema.optional(Schema.Int),
  text: Schema.optional(Schema.String),
});
export type MailSearchRequest = typeof MailSearchRequest.Type;

export const MailSearchResults = Schema.Struct({
  /** More matched than were returned, so the list is a top slice. */
  hasMore: Schema.Boolean,
  threads: Schema.Array(MailThreadSummary),
});
export type MailSearchResults = typeof MailSearchResults.Type;

export const MailSenderSuggestion = Schema.Struct({
  address: Schema.String,
  messageCount: Schema.Int,
  name: Schema.optional(Schema.String),
});
export type MailSenderSuggestion = typeof MailSenderSuggestion.Type;

/** Which side of a message to draw addresses from, or both for composing. */
export const MailAddressRole = Schema.Literals([
  "correspondent",
  "recipient",
  "sender",
]);
export type MailAddressRole = typeof MailAddressRole.Type;

export const MailSenderSuggestionRequest = Schema.Struct({
  accountIds: Schema.Array(Schema.NonEmptyString),
  limit: Schema.optional(Schema.Int),
  query: Schema.optional(Schema.String),
  role: Schema.optional(MailAddressRole),
});
export type MailSenderSuggestionRequest =
  typeof MailSenderSuggestionRequest.Type;

export const MailSenderSuggestions = Schema.Struct({
  senders: Schema.Array(MailSenderSuggestion),
});
export type MailSenderSuggestions = typeof MailSenderSuggestions.Type;

export const MailIndexStatus = Schema.Literals([
  "complete",
  "failed",
  "idle",
  "paused",
  "running",
]);
export type MailIndexStatus = typeof MailIndexStatus.Type;

/**
 * Progress for the full-account mail index. This rides its own channel rather
 * than the threads-changed event, which triggers a first-page reload in the
 * renderer — at one update per indexed page that would rebuild the list
 * continuously for the length of the backfill.
 */
export const MailIndexProgress = Schema.Struct({
  accountId: Schema.NonEmptyString,
  error: Schema.optional(Schema.String),
  estimatedMessages: Schema.optional(Schema.Int),
  estimatedThreads: Schema.optional(Schema.Int),
  indexedMessages: Schema.Int,
  indexedThreads: Schema.Int,
  /** Oldest message indexed so far — "indexed back to March 2019". */
  oldestIndexedAt: Schema.optional(Schema.Int),
  status: MailIndexStatus,
});
export type MailIndexProgress = typeof MailIndexProgress.Type;

export const MailIndexProgressList = Schema.Struct({
  accounts: Schema.Array(MailIndexProgress),
});
export type MailIndexProgressList = typeof MailIndexProgressList.Type;

export const MailLabelCatalogReply = IpcReply(MailLabelCatalog);
export type MailLabelCatalogReply = typeof MailLabelCatalogReply.Type;

export const MailLabelCreateReply = IpcReply(MailLabelSummary);
export type MailLabelCreateReply = typeof MailLabelCreateReply.Type;

export const MailLabelDeleteReply = IpcReply(Schema.Void);
export type MailLabelDeleteReply = typeof MailLabelDeleteReply.Type;

export const MailLabelUpdateReply = IpcReply(MailLabelSummary);
export type MailLabelUpdateReply = typeof MailLabelUpdateReply.Type;

export const MailCachedThreadPageReply = IpcReply(MailCachedThreadPage);
export type MailCachedThreadPageReply = typeof MailCachedThreadPageReply.Type;

export const MailThreadReply = IpcReply(MailThread);
export type MailThreadReply = typeof MailThreadReply.Type;
export const MailAttachmentActionReply = IpcReply(Schema.Void);
export type MailAttachmentActionReply = typeof MailAttachmentActionReply.Type;
export const MailAttachmentSaveReply = IpcReply(MailAttachmentSaveOutcome);
export type MailAttachmentSaveReply = typeof MailAttachmentSaveReply.Type;
export const MailAttachmentPreviewReply = IpcReply(MailAttachmentPreview);
export type MailAttachmentPreviewReply = typeof MailAttachmentPreviewReply.Type;

export const MailSearchResultsReply = IpcReply(MailSearchResults);
export type MailSearchResultsReply = typeof MailSearchResultsReply.Type;

export const MailSenderSuggestionsReply = IpcReply(MailSenderSuggestions);
export type MailSenderSuggestionsReply = typeof MailSenderSuggestionsReply.Type;

export const MailTrustedImageSendersReply = IpcReply(
  Schema.Array(MailTrustedImageSender)
);
export type MailTrustedImageSendersReply =
  typeof MailTrustedImageSendersReply.Type;

export const MailThreadMutationReply = IpcReply(Schema.Void);
export type MailThreadMutationReply = typeof MailThreadMutationReply.Type;

export const MailBulkThreadMutationReply = IpcReply(
  MailBulkThreadMutationResult
);
export type MailBulkThreadMutationReply =
  typeof MailBulkThreadMutationReply.Type;

export const MailSpamStatusReply = IpcReply(MailSpamStatus);
export type MailSpamStatusReply = typeof MailSpamStatusReply.Type;

export const MailReindexReply = IpcReply(Schema.Void);
export type MailReindexReply = typeof MailReindexReply.Type;

/** A sent message; the server may have refused some recipients. */
export const MailSendOutcome = Schema.Struct({
  refusedRecipients: Schema.Array(Schema.String),
});
export type MailSendOutcome = typeof MailSendOutcome.Type;

export const MailThreadMessageSendReply = IpcReply(MailSendOutcome);
export type MailThreadMessageSendReply = typeof MailThreadMessageSendReply.Type;

export const MailMessageSendReply = IpcReply(MailSendOutcome);
export type MailMessageSendReply = typeof MailMessageSendReply.Type;

export const MailOutgoingAttachmentPrepareReply = IpcReply(
  Schema.Array(MailOutgoingAttachmentCapability)
);
export type MailOutgoingAttachmentPrepareReply =
  typeof MailOutgoingAttachmentPrepareReply.Type;

export const MailOutgoingAttachmentSelectionReply = IpcReply(
  Schema.Array(MailDraftAttachment)
);
export type MailOutgoingAttachmentSelectionReply =
  typeof MailOutgoingAttachmentSelectionReply.Type;
export const MailOutgoingInlineImagePreviewReply = IpcReply(
  MailOutgoingInlineImagePreview
);
export type MailOutgoingInlineImagePreviewReply =
  typeof MailOutgoingInlineImagePreviewReply.Type;
export const MailDraftReply = IpcReply(MailDraft);
export type MailDraftReply = typeof MailDraftReply.Type;
export const MailDraftListReply = IpcReply(Schema.Array(MailDraft));
export type MailDraftListReply = typeof MailDraftListReply.Type;
export const MailDraftLoadReply = IpcReply(Schema.NullOr(MailDraft));
export type MailDraftLoadReply = typeof MailDraftLoadReply.Type;
export const MailDraftDiscardReply = IpcReply(Schema.Void);
export type MailDraftDiscardReply = typeof MailDraftDiscardReply.Type;
