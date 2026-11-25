import type { Deferred, Effect, Redacted, Scope } from "effect";
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
  /** Messages without `\Seen`, where the server says. */
  readonly unseen?: number | undefined;
}

/**
 * How a wait in a mailbox ended: mail `arrived`, something else `changed`
 * (mail left, or a flag was set or cleared), or nothing was reported.
 */
export type WatchOutcome = "arrived" | "changed" | "quiet";

export interface WatchOptions {
  /** The wait ends as `quiet` after this long without a report. */
  readonly maxMs: number;
  /**
   * Completed to end the wait early, as `quiet`, with the connection ready
   * for its next command. Interrupting the wait abandons the connection
   * instead, as it does for any other call.
   */
  readonly stop: Deferred.Deferred<void>;
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
 *
 * A UID names a message only under the UIDVALIDITY it was read under: a
 * mailbox deleted and made again, or rebuilt by its server, numbers its mail
 * afresh. So every call that takes or returns UIDs also takes the
 * UIDVALIDITY the caller knows the mailbox under. When the mailbox the
 * server has under that name carries another, the call sends nothing and
 * fails with `MailboxMissingError`: the mailbox the caller means is gone.
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
    uidValidity: bigint,
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
    uidValidity: bigint,
    uids: readonly number[]
  ) => Effect.Effect<void, MailTransportError>;
  readonly fetch: (
    path: string,
    uidValidity: bigint,
    selection: UidSelection,
    fields: FetchFields,
    options?: { readonly changedSince?: bigint }
  ) => Effect.Effect<readonly FetchedMessage[], MailTransportError>;
  /** One section of one message, still transfer-encoded; `undefined` if gone. */
  readonly fetchSection: (
    path: string,
    uidValidity: bigint,
    uid: number,
    section: string,
    maxBytes: number
  ) => Effect.Effect<Uint8Array | undefined, MailTransportError>;
  /**
   * Whether any message of the mailbox matches. It names no message, so it
   * takes no UIDVALIDITY: for asking whether mail is there at all.
   */
  readonly hasMessage: (
    path: string,
    search: MailboxSearch
  ) => Effect.Effect<boolean, MailTransportError>;
  readonly listMailboxes: Effect.Effect<
    readonly ImapMailbox[],
    MailTransportError
  >;
  /** Moves messages to another mailbox (UID MOVE, or copy and expunge). */
  readonly move: (
    path: string,
    uidValidity: bigint,
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
    uidValidity: bigint,
    search: MailboxSearch
  ) => Effect.Effect<readonly number[], MailTransportError>;
  /** Adds or removes Gmail labels (STORE ±X-GM-LABELS). */
  readonly setGmailLabels: (
    path: string,
    uidValidity: bigint,
    uids: readonly number[],
    operation: "add" | "remove",
    labels: readonly string[]
  ) => Effect.Effect<void, MailTransportError>;
  /** Adds or removes flags (STORE ±FLAGS.SILENT); opens the mailbox read-write. */
  readonly setFlags: (
    path: string,
    uidValidity: bigint,
    uids: readonly number[],
    operation: "add" | "remove",
    flags: readonly string[]
  ) => Effect.Effect<void, MailTransportError>;
  readonly status: (
    path: string
  ) => Effect.Effect<MailboxState, MailTransportError>;
  /**
   * Waits in a mailbox until the server reports anything there (IDLE): mail
   * arriving or leaving, or a flag changing. The session carries no other
   * call until the wait ends.
   */
  readonly watch: (
    path: string,
    options: WatchOptions
  ) => Effect.Effect<WatchOutcome, MailTransportError>;
}

/**
 * An account's sign-in, redacted wherever it travels: its app password, or an
 * OAuth access token for a provider that takes no passwords (SASL XOAUTH2).
 */
export type ImapAuth =
  | {
      readonly kind: "password";
      readonly password: Redacted.Redacted<string>;
      readonly user: string;
    }
  | {
      readonly accessToken: Redacted.Redacted<string>;
      /**
       * When the token stops working, in milliseconds since the epoch. The
       * server ends the session then, so the connection closes shortly before.
       */
      readonly expiresAt: number;
      readonly kind: "oauth";
      readonly user: string;
    };

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
