// oxlint-disable eslint/max-classes-per-file
import type { Redacted } from "effect";
import { Schema } from "effect";

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0));

export const AccountId = Schema.NonEmptyString.pipe(Schema.brand("AccountId"));
export type AccountId = typeof AccountId.Type;

export const LabelId = Schema.NonEmptyString.pipe(Schema.brand("LabelId"));
export type LabelId = typeof LabelId.Type;

export const ThreadId = Schema.NonEmptyString.pipe(Schema.brand("ThreadId"));
export type ThreadId = typeof ThreadId.Type;

export const MessageId = Schema.NonEmptyString.pipe(Schema.brand("MessageId"));
export type MessageId = typeof MessageId.Type;

export const AttachmentId = Schema.NonEmptyString.pipe(
  Schema.brand("AttachmentId")
);
export type AttachmentId = typeof AttachmentId.Type;

export const HistoryId = Schema.NonEmptyString.pipe(Schema.brand("HistoryId"));
export type HistoryId = typeof HistoryId.Type;

export const PageCursor = Schema.NonEmptyString.pipe(
  Schema.brand("PageCursor")
);
export type PageCursor = typeof PageCursor.Type;

export const GmailScope = Schema.Literals([
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
]);
export type GmailScope = typeof GmailScope.Type;

export const GMAIL_MODIFY_SCOPE: GmailScope =
  "https://www.googleapis.com/auth/gmail.modify";
export const GMAIL_READONLY_SCOPE: GmailScope =
  "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_SEND_SCOPE: GmailScope =
  "https://www.googleapis.com/auth/gmail.send";

export class GmailCapabilities extends Schema.Class<GmailCapabilities>(
  "@repo/gmail/GmailCapabilities"
)({
  modify: Schema.Boolean,
  read: Schema.Boolean,
  send: Schema.Boolean,
}) {}

export class GmailAccount extends Schema.Class<GmailAccount>(
  "@repo/gmail/GmailAccount"
)({
  avatarUrl: Schema.optional(Schema.String),
  capabilities: GmailCapabilities,
  displayName: Schema.optional(Schema.String),
  email: Schema.NonEmptyString,
  id: AccountId,
  scopes: Schema.Array(GmailScope),
}) {}

export interface GmailCredentials {
  readonly accessToken: Redacted.Redacted<string>;
  readonly expiresAt?: number;
  readonly refreshToken?: Redacted.Redacted<string>;
}

export interface GmailAuthorization {
  readonly account: GmailAccount;
  readonly credentials: GmailCredentials;
}

export interface GmailCredentialPatch {
  readonly accessToken?: Redacted.Redacted<string>;
  readonly expiresAt?: number;
  readonly refreshToken?: Redacted.Redacted<string>;
}

export class Mailbox extends Schema.Class<Mailbox>("@repo/gmail/Mailbox")({
  address: Schema.NonEmptyString,
  name: Schema.optional(Schema.String),
}) {}

export class LabelColor extends Schema.Class<LabelColor>(
  "@repo/gmail/LabelColor"
)({
  background: Schema.String,
  text: Schema.String,
}) {}

export class GmailLabel extends Schema.Class<GmailLabel>(
  "@repo/gmail/GmailLabel"
)({
  color: Schema.optional(LabelColor),
  id: LabelId,
  messageCount: Schema.optional(NonNegativeInt),
  messageListVisibility: Schema.optional(Schema.Literals(["hide", "show"])),
  name: Schema.NonEmptyString,
  threadCount: Schema.optional(NonNegativeInt),
  type: Schema.Literals(["system", "user"]),
}) {}

export class AttachmentSummary extends Schema.Class<AttachmentSummary>(
  "@repo/gmail/AttachmentSummary"
)({
  attachmentId: AttachmentId,
  contentId: Schema.optional(Schema.String),
  filename: Schema.NonEmptyString,
  mediaType: Schema.NonEmptyString,
  messageId: MessageId,
  size: NonNegativeInt,
}) {}

export class ThreadSummary extends Schema.Class<ThreadSummary>(
  "@repo/gmail/ThreadSummary"
)({
  /** Thread list rows show attachment pills, so summaries carry the list. */
  attachments: Schema.Array(AttachmentSummary),
  hasAttachments: Schema.Boolean,
  hasUnread: Schema.Boolean,
  id: ThreadId,
  labelIds: Schema.Array(LabelId),
  latestAt: Schema.String,
  latestMessageId: MessageId,
  messageCount: PositiveInt,
  participants: Schema.Array(Mailbox),
  snippet: Schema.String,
  subject: Schema.String,
}) {}

export const DisplayBody = Schema.Union([
  Schema.Struct({
    text: Schema.String,
    type: Schema.Literal("text"),
  }),
  Schema.Struct({
    hasBlockedRemoteImages: Schema.Boolean,
    sanitizedHtml: Schema.String,
    type: Schema.Literal("html"),
  }),
]);
export type DisplayBody = typeof DisplayBody.Type;

export class GmailMessage extends Schema.Class<GmailMessage>(
  "@repo/gmail/GmailMessage"
)({
  attachments: Schema.Array(AttachmentSummary),
  bcc: Schema.Array(Mailbox),
  body: DisplayBody,
  cc: Schema.Array(Mailbox),
  from: Mailbox,
  id: MessageId,
  labelIds: Schema.Array(LabelId),
  replyTo: Schema.optional(Mailbox),
  sentAt: Schema.String,
  subject: Schema.String,
  threadId: ThreadId,
  to: Schema.Array(Mailbox),
}) {}

export class GmailThread extends Schema.Class<GmailThread>(
  "@repo/gmail/GmailThread"
)({
  historyId: HistoryId,
  id: ThreadId,
  labelIds: Schema.Array(LabelId),
  messages: Schema.Array(GmailMessage),
}) {}

export interface ListLabelsOptions {
  readonly accountId: AccountId;
  readonly refresh?: boolean;
}

export interface DisconnectAccountOptions {
  readonly accountId: AccountId;
  readonly revoke?: boolean;
}

export interface ListThreadsFirstPageRequest {
  readonly accountId: AccountId;
  readonly includeSpamTrash?: boolean;
  readonly labelIds?: readonly LabelId[];
  readonly pageSize?: number;
  readonly search?: string;
}

export interface ListThreadsNextPageRequest {
  readonly accountId: AccountId;
  readonly cursor: PageCursor;
}

export type ListThreadsRequest =
  | ListThreadsFirstPageRequest
  | ListThreadsNextPageRequest;

export interface ThreadPage {
  readonly hasMore: boolean;
  readonly items: readonly ThreadSummary[];
  readonly nextCursor?: PageCursor;
}

export interface GetThreadRequest {
  readonly accountId: AccountId;
  readonly refresh?: boolean;
  readonly threadId: ThreadId;
}

export interface GetAttachmentRequest {
  readonly accountId: AccountId;
  readonly attachmentId: AttachmentId;
  readonly filename: string;
  readonly mediaType: string;
  readonly messageId: MessageId;
}

export interface ThreadMutationRequest {
  readonly accountId: AccountId;
  readonly threadId: ThreadId;
}

export interface GmailAttachment {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mediaType: string;
}

export type ComposerBody =
  | { readonly text: string; readonly type: "text" }
  | { readonly html: string; readonly text?: string; readonly type: "html" };

export interface OutgoingAttachment {
  readonly bytes: Uint8Array;
  readonly contentId?: string;
  readonly filename: string;
  readonly mediaType: string;
}

export interface ForwardInput {
  readonly accountId: AccountId;
  readonly bcc?: readonly Mailbox[];
  readonly body: ComposerBody;
  readonly cc?: readonly Mailbox[];
  readonly forwardMessageId: MessageId;
  readonly threadId: ThreadId;
  readonly to: readonly Mailbox[];
}

export interface SendMessageInput {
  readonly accountId: AccountId;
  readonly attachments?: readonly OutgoingAttachment[];
  readonly bcc?: readonly Mailbox[];
  readonly body: ComposerBody;
  readonly cc?: readonly Mailbox[];
  readonly subject: string;
  readonly to: readonly Mailbox[];
}

export interface ReplyInput {
  readonly accountId: AccountId;
  readonly attachments?: readonly OutgoingAttachment[];
  readonly bcc?: readonly Mailbox[];
  readonly body: ComposerBody;
  readonly cc?: readonly Mailbox[];
  readonly replyToMessageId: MessageId;
  readonly threadId: ThreadId;
  readonly to?: readonly Mailbox[];
}

export class SentMessage extends Schema.Class<SentMessage>(
  "@repo/gmail/SentMessage"
)({
  id: MessageId,
  threadId: ThreadId,
}) {}

export type SyncReason =
  | "after-send"
  | "focus"
  | "manual"
  | "startup"
  | "timer";

export interface SyncRequest {
  readonly accountId: AccountId;
  readonly reason: SyncReason;
}

export type SyncResult =
  | {
      readonly changedThreadIds: readonly ThreadId[];
      readonly type: "initial";
    }
  | {
      readonly changedThreadIds: readonly ThreadId[];
      readonly type: "partial";
    }
  | {
      readonly changedThreadIds: readonly ThreadId[];
      readonly type: "cursor-recovered";
    };
