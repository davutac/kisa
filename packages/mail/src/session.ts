import type { Effect, Redacted, Scope } from "effect";
import { Context } from "effect";

import type { MailTransportError } from "./errors";
import type { AccountId, MailboxRole } from "./ids";
import type { BodyStructureNode } from "./mime-structure";

export interface ImapMailbox {
  readonly delimiter: string;
  readonly flags: readonly string[];
  readonly path: string;
  readonly role: MailboxRole;
  readonly selectable: boolean;
}

export interface MailboxState {
  /** Absent when the server does not keep mod-sequences (no CONDSTORE). */
  readonly highestModseq?: bigint | undefined;
  readonly messages: number;
  readonly path: string;
  readonly uidNext: number;
  readonly uidValidity: bigint;
}

export interface EnvelopeAddress {
  readonly address?: string | undefined;
  readonly name?: string | undefined;
}

/** The decoded `ENVELOPE` of a message. */
export interface MessageEnvelope {
  readonly bcc: readonly EnvelopeAddress[];
  readonly cc: readonly EnvelopeAddress[];
  /** The `Date` header in epoch milliseconds, when it parses. */
  readonly date?: number | undefined;
  readonly from: readonly EnvelopeAddress[];
  readonly inReplyTo?: string | undefined;
  readonly messageId?: string | undefined;
  readonly replyTo: readonly EnvelopeAddress[];
  readonly sender: readonly EnvelopeAddress[];
  readonly subject?: string | undefined;
  readonly to: readonly EnvelopeAddress[];
}

export interface FetchedMessage {
  readonly envelope?: MessageEnvelope | undefined;
  readonly flags: readonly string[];
  readonly gmailLabels?: readonly string[] | undefined;
  /** `X-GM-MSGID` as a decimal string. */
  readonly gmailMessageId?: string | undefined;
  /** `X-GM-THRID` as a decimal string. */
  readonly gmailThreadId?: string | undefined;
  /** The requested header block, raw. */
  readonly headers?: Uint8Array | undefined;
  /** `INTERNALDATE` in epoch milliseconds. */
  readonly internalDate?: number | undefined;
  readonly modseq?: bigint | undefined;
  /** Requested body sections, still in their transfer encoding. */
  readonly sections?: ReadonlyMap<string, Uint8Array> | undefined;
  readonly size?: number | undefined;
  readonly structure?: BodyStructureNode | undefined;
  readonly uid: number;
}

export interface FetchFields {
  readonly envelope?: boolean;
  readonly flags?: boolean;
  /** `X-GM-MSGID`, `X-GM-THRID` and `X-GM-LABELS`. */
  readonly gmail?: boolean;
  /** Every header, or only the named ones. */
  readonly headers?: readonly string[] | true;
  readonly internalDate?: boolean;
  readonly sections?: readonly string[];
  readonly size?: boolean;
  readonly structure?: boolean;
}

export type UidSelection =
  | { readonly kind: "range"; readonly from: number; readonly to?: number }
  | { readonly kind: "uids"; readonly uids: readonly number[] };

export type MailboxSearch =
  | { readonly kind: "all" }
  | { readonly kind: "gmailMessage"; readonly messageId: string }
  | { readonly kind: "gmailRaw"; readonly query: string }
  | { readonly kind: "gmailThread"; readonly threadId: string }
  | { readonly kind: "header"; readonly name: string; readonly value: string }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "uidRange"; readonly from: number; readonly to: number };

/**
 * One authenticated IMAP connection. Every call names its mailbox; the
 * session selects it (read-only unless the call changes messages) and
 * serializes calls, so callers never manage the selected-mailbox state.
 */
export interface ImapSession {
  /** Stores a message in a mailbox (APPEND), as a client files sent mail. */
  readonly append: (
    path: string,
    message: Uint8Array,
    flags: readonly string[]
  ) => Effect.Effect<void, MailTransportError>;
  readonly capabilities: ReadonlySet<string>;
  /** Copies messages into another mailbox (UID COPY). */
  readonly copy: (
    path: string,
    uids: readonly number[],
    destination: string
  ) => Effect.Effect<void, MailTransportError>;
  readonly createMailbox: (
    path: string
  ) => Effect.Effect<void, MailTransportError>;
  readonly deleteMailbox: (
    path: string
  ) => Effect.Effect<void, MailTransportError>;
  /** Marks messages deleted and expunges exactly those UIDs where possible. */
  readonly expunge: (
    path: string,
    uids: readonly number[]
  ) => Effect.Effect<void, MailTransportError>;
  readonly fetch: (
    path: string,
    selection: UidSelection,
    fields: FetchFields,
    options?: { readonly changedSince?: bigint }
  ) => Effect.Effect<readonly FetchedMessage[], MailTransportError>;
  /** One section of one message, still transfer-encoded; `undefined` if gone. */
  readonly fetchSection: (
    path: string,
    uid: number,
    section: string,
    maxBytes: number
  ) => Effect.Effect<Uint8Array | undefined, MailTransportError>;
  readonly listMailboxes: Effect.Effect<
    readonly ImapMailbox[],
    MailTransportError
  >;
  /** Moves messages to another mailbox (UID MOVE, or copy and expunge). */
  readonly move: (
    path: string,
    uids: readonly number[],
    destination: string
  ) => Effect.Effect<void, MailTransportError>;
  readonly renameMailbox: (
    path: string,
    destination: string
  ) => Effect.Effect<void, MailTransportError>;
  /** UIDs of the matching messages, in ascending order. */
  readonly search: (
    path: string,
    search: MailboxSearch
  ) => Effect.Effect<readonly number[], MailTransportError>;
  /** Adds or removes Gmail labels (STORE ±X-GM-LABELS). */
  readonly setGmailLabels: (
    path: string,
    uids: readonly number[],
    operation: "add" | "remove",
    labels: readonly string[]
  ) => Effect.Effect<void, MailTransportError>;
  /** Adds or removes flags (STORE ±FLAGS.SILENT); opens the mailbox read-write. */
  readonly setFlags: (
    path: string,
    uids: readonly number[],
    operation: "add" | "remove",
    flags: readonly string[]
  ) => Effect.Effect<void, MailTransportError>;
  readonly status: (
    path: string
  ) => Effect.Effect<MailboxState, MailTransportError>;
}

/** An account's sign-in: its app password, redacted wherever it travels. */
export interface ImapAuth {
  readonly password: Redacted.Redacted<string>;
  readonly user: string;
}

export type TransportSecurity = "starttls" | "tls";

export interface ImapServer {
  readonly host: string;
  readonly port: number;
  readonly security: TransportSecurity;
}

export interface ImapConnectRequest {
  readonly accountId: AccountId;
  readonly auth: ImapAuth;
  readonly server: ImapServer;
}

/** Opens sessions. The session closes when its scope closes. */
export class ImapConnector extends Context.Service<
  ImapConnector,
  {
    readonly connect: (
      request: ImapConnectRequest
    ) => Effect.Effect<ImapSession, MailTransportError, Scope.Scope>;
  }
>()("@repo/mail/ImapConnector") {}
