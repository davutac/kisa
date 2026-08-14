import type { Effect } from "effect";
import { Context } from "effect";

import type { GmailMimeError, GmailValidationError } from "./errors";
import type { GatewayThread, RawMessage } from "./gateway";
import type {
  ForwardInput,
  GmailThread,
  ReplyInput,
  SendMessageInput,
} from "./models";

export interface GmailMimeService {
  readonly composeMessage: (
    input: SendMessageInput
  ) => Effect.Effect<RawMessage, GmailMimeError | GmailValidationError>;
  readonly composeForward: (
    input: ForwardInput,
    thread: GatewayThread
  ) => Effect.Effect<RawMessage, GmailMimeError | GmailValidationError>;
  readonly composeReply: (
    input: ReplyInput,
    thread: GatewayThread
  ) => Effect.Effect<RawMessage, GmailMimeError | GmailValidationError>;
  readonly parseThread: (
    thread: GatewayThread
  ) => Effect.Effect<GmailThread, GmailMimeError>;
}

export class GmailMime extends Context.Service<GmailMime, GmailMimeService>()(
  "@repo/gmail/GmailMime"
) {}
