import type { Effect } from "effect";
import { Context } from "effect";

import type {
  GmailApiError,
  GmailEntityNotFoundError,
  GmailHistoryExpiredError,
  GmailRateLimitError,
  GmailReauthorizationRequiredError,
  GmailSendOutcomeUnknownError,
} from "./errors";
import type {
  AccountId,
  GmailAttachment,
  GmailAuthorization,
  GmailCredentialPatch,
  GmailCredentials,
  GmailLabel,
  HistoryId,
  LabelColor,
  LabelId,
  MessageId,
  SentMessage,
  ThreadId,
  ThreadSummary,
} from "./models";

export type GmailGatewayError =
  | GmailApiError
  | GmailEntityNotFoundError
  | GmailHistoryExpiredError
  | GmailRateLimitError
  | GmailReauthorizationRequiredError;

export interface GatewayResult<A> {
  readonly credentialPatch?: GmailCredentialPatch;
  readonly value: A;
}

export interface GatewayThreadPage {
  /**
   * The raw threads the summaries were built from. Summaries already require a
   * `threads.get` with `format: "full"` per thread, so the bodies are on the
   * wire either way — carrying them here is what lets the store index them
   * without a second request.
   */
  readonly details: readonly GatewayThread[];
  readonly historyId?: HistoryId;
  readonly nextPageToken?: string;
  readonly threads: readonly ThreadSummary[];
}

export interface GatewayThread {
  readonly historyId: HistoryId;
  readonly id: ThreadId;
  readonly labelIds: readonly string[];
  readonly messages: readonly unknown[];
}

export interface GatewayAttachmentRequest {
  readonly attachmentId: string;
  readonly filename: string;
  readonly mediaType: string;
  readonly messageId: string;
}

export interface GatewayListThreadsRequest {
  readonly includeSpamTrash: boolean;
  readonly labelIds: readonly string[];
  readonly pageSize: number;
  readonly pageToken?: string;
  readonly search?: string;
}

export interface GatewayHistoryResult {
  /** Messages Gmail explicitly reported as added since the saved cursor. */
  readonly addedMessageIds: readonly MessageId[];
  /** See `GatewayThreadPage.details`. */
  readonly details: readonly GatewayThread[];
  readonly historyId: HistoryId;
  /** Threads whose complete current message set was added in this history window. */
  readonly newThreadCandidateIds: readonly ThreadId[];
  readonly removedThreadIds: readonly ThreadId[];
  readonly threads: readonly ThreadSummary[];
}

export interface RawMessage {
  readonly raw: string;
  readonly threadId?: ThreadId;
}

export interface GmailIdentity {
  readonly avatarUrl?: string;
  readonly displayName?: string;
  readonly email: string;
  readonly id: AccountId;
}

export interface GatewayMailboxTotals {
  readonly messagesTotal: number;
  readonly threadsTotal: number;
}

export interface GmailGatewayService {
  readonly createLabel: (
    authorization: GmailAuthorization,
    name: string,
    color?: LabelColor
  ) => Effect.Effect<GatewayResult<GmailLabel>, GmailGatewayError>;
  readonly deleteLabel: (
    authorization: GmailAuthorization,
    labelId: LabelId
  ) => Effect.Effect<GatewayResult<void>, GmailGatewayError>;
  readonly deleteThread: (
    authorization: GmailAuthorization,
    threadId: ThreadId
  ) => Effect.Effect<GatewayResult<void>, GmailGatewayError>;
  readonly getAttachment: (
    authorization: GmailAuthorization,
    request: GatewayAttachmentRequest
  ) => Effect.Effect<GatewayResult<GmailAttachment>, GmailGatewayError>;
  readonly getCurrentHistoryId: (
    authorization: GmailAuthorization
  ) => Effect.Effect<GatewayResult<HistoryId>, GmailGatewayError>;
  readonly getLabels: (
    authorization: GmailAuthorization,
    labelIds: readonly LabelId[]
  ) => Effect.Effect<GatewayResult<readonly GmailLabel[]>, GmailGatewayError>;
  readonly patchLabel: (
    authorization: GmailAuthorization,
    labelId: LabelId,
    name: string,
    color?: LabelColor
  ) => Effect.Effect<GatewayResult<GmailLabel>, GmailGatewayError>;
  /**
   * The mailbox's own totals, which is the only cheap way to get a denominator
   * for indexing progress — one quota unit, versus walking every page to count.
   */
  readonly getMailboxTotals: (
    authorization: GmailAuthorization
  ) => Effect.Effect<GatewayResult<GatewayMailboxTotals>, GmailGatewayError>;
  readonly findSentMessageByRfc822MessageId: (
    authorization: GmailAuthorization,
    rfc822MessageId: string
  ) => Effect.Effect<GatewayResult<SentMessage | undefined>, GmailGatewayError>;
  readonly getThread: (
    authorization: GmailAuthorization,
    threadId: ThreadId
  ) => Effect.Effect<GatewayResult<GatewayThread>, GmailGatewayError>;
  readonly identifyAccount: (
    credentials: GmailCredentials,
    scopes: readonly string[]
  ) => Effect.Effect<GmailIdentity, GmailGatewayError>;
  readonly listHistory: (
    authorization: GmailAuthorization,
    historyId: HistoryId
  ) => Effect.Effect<GatewayResult<GatewayHistoryResult>, GmailGatewayError>;
  readonly listLabels: (
    authorization: GmailAuthorization
  ) => Effect.Effect<GatewayResult<readonly GmailLabel[]>, GmailGatewayError>;
  readonly listThreads: (
    authorization: GmailAuthorization,
    request: GatewayListThreadsRequest
  ) => Effect.Effect<GatewayResult<GatewayThreadPage>, GmailGatewayError>;
  readonly modifyThreadLabels: (
    authorization: GmailAuthorization,
    request: {
      readonly addLabelIds: readonly string[];
      readonly removeLabelIds: readonly string[];
      readonly threadId: ThreadId;
    }
  ) => Effect.Effect<GatewayResult<void>, GmailGatewayError>;
  readonly batchModifyMessageLabels: (
    authorization: GmailAuthorization,
    request: {
      readonly addLabelIds: readonly string[];
      readonly messageIds: readonly MessageId[];
      readonly removeLabelIds: readonly string[];
    }
  ) => Effect.Effect<GatewayResult<void>, GmailGatewayError>;
  readonly revoke: (
    authorization: GmailAuthorization
  ) => Effect.Effect<void, GmailApiError>;
  readonly send: (
    authorization: GmailAuthorization,
    message: RawMessage
  ) => Effect.Effect<
    GatewayResult<SentMessage>,
    GmailGatewayError | GmailSendOutcomeUnknownError
  >;
  readonly trashThread: (
    authorization: GmailAuthorization,
    threadId: ThreadId
  ) => Effect.Effect<GatewayResult<void>, GmailGatewayError>;
}

export class GmailGateway extends Context.Service<
  GmailGateway,
  GmailGatewayService
>()("@repo/gmail/GmailGateway") {}

export interface AuthorizedIdentity {
  readonly accountId: AccountId;
  readonly email: string;
}

export interface MessageReference {
  readonly messageId: MessageId;
  readonly threadId: ThreadId;
}
