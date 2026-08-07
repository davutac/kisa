import type { Effect } from "effect";
import { Context } from "effect";

import type {
  GmailApiError,
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
  MessageId,
  SentMessage,
  ThreadId,
  ThreadSummary,
} from "./models";

export type GmailGatewayError =
  | GmailApiError
  | GmailHistoryExpiredError
  | GmailRateLimitError
  | GmailReauthorizationRequiredError;

export interface GatewayResult<A> {
  readonly credentialPatch?: GmailCredentialPatch;
  readonly value: A;
}

export interface GatewayThreadPage {
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
  readonly historyId: HistoryId;
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

export interface GmailGatewayService {
  readonly getAttachment: (
    authorization: GmailAuthorization,
    request: GatewayAttachmentRequest
  ) => Effect.Effect<GatewayResult<GmailAttachment>, GmailGatewayError>;
  readonly getCurrentHistoryId: (
    authorization: GmailAuthorization
  ) => Effect.Effect<GatewayResult<HistoryId>, GmailGatewayError>;
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
