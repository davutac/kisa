import type { Effect, Option } from "effect";
import { Context } from "effect";

import type { DialectKind, UserLabel } from "./dialects";
import type { MailStoreError } from "./errors";
import type { MessageHeader } from "./headers";
import type {
  AccountId,
  LabelId,
  MailboxRole,
  MessageId,
  ThreadId,
} from "./ids";
import type { MessageStructure } from "./mime-structure";
import type { ImapServer, TransportSecurity } from "./session";

export interface SmtpServer {
  readonly host: string;
  readonly port: number;
  readonly security: TransportSecurity;
}

export interface MailAccount {
  readonly accountId: AccountId;
  readonly dialect: DialectKind;
  readonly email: string;
  readonly imap: ImapServer;
  readonly provider: "gmail" | "icloud" | "imap" | "outlook";
  readonly smtp: SmtpServer;
  readonly username: string;
}

export interface MailboxRecord {
  readonly delimiter: string;
  /** Where the next slice of re-read flags starts, without CONDSTORE. */
  readonly flagCursor?: number | undefined;
  readonly highestModseq?: bigint | undefined;
  /**
   * Gmail: while set, cached copies' labels are read again below this UID,
   * since a label renamed elsewhere is not reported as a change to them.
   */
  readonly labelCursor?: number | undefined;
  readonly messageCount?: number | undefined;
  readonly path: string;
  readonly role: MailboxRole;
  readonly selectable: boolean;
  /** Every UID at or above this has cached metadata; 1 means complete. */
  readonly skeletonFloor?: number | undefined;
  readonly synced: boolean;
  readonly uidNext?: number | undefined;
  readonly uidValidity?: bigint | undefined;
}

/** The copies of a mailbox, counted. */
export interface MailboxCounts {
  readonly copies: number;
  readonly unread: number;
}

/** What the server last said about a mailbox, saved with the work it covers. */
export interface MailboxProgress {
  readonly flagCursor?: number | undefined;
  readonly highestModseq?: bigint | undefined;
  /** `null` ends the label reread. */
  readonly labelCursor?: number | null | undefined;
  readonly messageCount?: number | undefined;
  readonly skeletonFloor?: number | undefined;
  readonly uidNext?: number | undefined;
  readonly uidValidity?: bigint | undefined;
}

export interface MailAddress {
  readonly address: string;
  readonly name?: string | undefined;
}

/** A message as the skeleton knows it: enough to list, thread and search it. */
export interface MessageMetadata {
  readonly bcc: readonly string[];
  readonly cc: readonly string[];
  readonly firstReference?: string | undefined;
  readonly from: MailAddress;
  readonly inReplyTo?: string | undefined;
  readonly messageId: MessageId;
  readonly receivedAt: number;
  readonly replyTo?: string | undefined;
  readonly rfc822MessageId?: string | undefined;
  readonly sentAt?: number | undefined;
  readonly size: number;
  readonly subject: string;
  readonly threadId: ThreadId;
  readonly to: readonly string[];
}

/** One copy of a message in the mailbox a batch belongs to. */
export interface MessageLocation {
  readonly flags: readonly string[];
  /** The labels this copy gives its message. */
  readonly labelIds: readonly LabelId[];
  readonly messageId: MessageId;
  readonly modseq?: bigint | undefined;
  readonly uid: number;
}

export interface MailboxBatch {
  readonly locations: readonly MessageLocation[];
  /** Metadata never overwrites a stored body. */
  readonly messages: readonly MessageMetadata[];
  readonly path: string;
  /** Saved in the same transaction, so progress never runs ahead of data. */
  readonly progress: MailboxProgress;
  readonly uidValidity: bigint;
}

/** New flags and labels for copies already cached. Unknown UIDs are ignored. */
export interface LocationChange {
  readonly flags: readonly string[];
  readonly labelIds: readonly LabelId[];
  readonly modseq?: bigint | undefined;
  readonly uid: number;
}

export interface MessageBodies {
  /** The parts could not be read; the message keeps its metadata. */
  readonly failed?: boolean;
  readonly headers: readonly MessageHeader[];
  readonly html?: string | undefined;
  readonly messageId: MessageId;
  readonly structure?: MessageStructure | undefined;
  readonly text?: string | undefined;
}

/** A message whose body is not cached, with one copy to fetch it from. */
export interface BodyCandidate {
  readonly mailboxPath: string;
  readonly messageId: MessageId;
  readonly receivedAt: number;
  readonly size: number;
  readonly uid: number;
  /** The UIDVALIDITY the copy's UID was read under. */
  readonly uidValidity: bigint;
}

/** A cached copy of a thread's message, for changes made on the server. */
export interface ThreadLocation {
  readonly flags: readonly string[];
  readonly threadId: ThreadId;
  readonly labelIds: readonly LabelId[];
  readonly mailboxPath: string;
  readonly messageId: MessageId;
  readonly uid: number;
  /** The UIDVALIDITY the copy's UID was read under. */
  readonly uidValidity: bigint;
}

export interface StoredAttachment {
  readonly encoding?: string | undefined;
  readonly filename: string;
  readonly mailboxPath: string;
  readonly mediaType: string;
  readonly section: string;
  readonly size: number;
  readonly uid: number;
  /** The UIDVALIDITY the copy's UID was read under. */
  readonly uidValidity: bigint;
}

/** Where one copy of a message was before an action moved it to Trash. */
export interface CopyOrigin {
  readonly mailboxPath: string;
  readonly messageId: MessageId;
}

/** A user label renamed on the server, with its mailbox. */
export interface LabelRename {
  readonly delimiter: string;
  readonly from: { readonly id: LabelId; readonly path: string };
  readonly to: { readonly id: LabelId; readonly path: string };
}

/** Which conversations a write touched, for renderer events. */
export interface ThreadChanges {
  /**
   * Messages this write cached for the first time. From an incremental sync
   * they are new mail; the skeleton walk drops them, since it caches old mail.
   */
  readonly arrived?: readonly MessageId[] | undefined;
  readonly changed: readonly ThreadId[];
  readonly removed: readonly ThreadId[];
}

export interface MailEngineStoreService {
  readonly applyLocationChanges: (
    accountId: AccountId,
    path: string,
    changes: readonly LocationChange[],
    progress: MailboxProgress
  ) => Effect.Effect<ThreadChanges, MailStoreError>;
  readonly applyMailboxBatch: (
    accountId: AccountId,
    batch: MailboxBatch
  ) => Effect.Effect<ThreadChanges, MailStoreError>;
  /** Deletes everything cached for an account. */
  readonly clearAccount: (
    accountId: AccountId
  ) => Effect.Effect<void, MailStoreError>;
  /** Newest first. `receivedAfter` limits the pass to recent mail. */
  readonly bodyCandidates: (
    accountId: AccountId,
    options: { readonly limit: number; readonly receivedAfter?: number }
  ) => Effect.Effect<readonly BodyCandidate[], MailStoreError>;
  /**
   * Deletes messages left without any copy. Does nothing until every synced
   * mailbox's skeleton is complete, because before then a missing copy may
   * only be one the walk has not reached.
   */
  /** The mailboxes remembered for these messages, one entry per copy. */
  readonly copyOrigins: (
    accountId: AccountId,
    messageIds: readonly MessageId[]
  ) => Effect.Effect<ReadonlyMap<MessageId, readonly string[]>>;
  readonly collectOrphans: (
    accountId: AccountId
  ) => Effect.Effect<ThreadChanges, MailStoreError>;
  readonly findAttachment: (
    accountId: AccountId,
    messageId: MessageId,
    section: string
  ) => Effect.Effect<Option.Option<StoredAttachment>, MailStoreError>;
  readonly forgetCopyOrigins: (
    accountId: AccountId,
    messageIds: readonly MessageId[]
  ) => Effect.Effect<void>;
  readonly getAccount: (
    accountId: AccountId
  ) => Effect.Effect<Option.Option<MailAccount>, MailStoreError>;
  readonly getMailboxes: (
    accountId: AccountId
  ) => Effect.Effect<readonly MailboxRecord[], MailStoreError>;
  /** The UIDs a mailbox has cached, or only those at or above `from`. */
  readonly locationUids: (
    accountId: AccountId,
    path: string,
    from?: number
  ) => Effect.Effect<readonly number[], MailStoreError>;
  /**
   * How many copies a mailbox has cached, and how many of them are unread,
   * to hold against the counts the server gives for it.
   */
  readonly mailboxCounts: (
    accountId: AccountId,
    path: string
  ) => Effect.Effect<MailboxCounts, MailStoreError>;
  /**
   * Deletes these messages if no copy of them is left. Unlike
   * `collectOrphans`, it does not wait for skeletons: it is for messages the
   * user deleted for good.
   */
  /**
   * Remembers where copies were before an action moved them to Trash, so
   * Undo can put them back, and forgets whatever was remembered for every
   * other message in `moved`. Kept in memory, not in SQLite: only Undo reads
   * it, seconds later, and after a restart a restore falls back to the Inbox.
   */
  readonly rememberCopyOrigins: (
    accountId: AccountId,
    moved: readonly MessageId[],
    origins: readonly CopyOrigin[]
  ) => Effect.Effect<void>;
  readonly removeMessagesWithoutCopies: (
    accountId: AccountId,
    messageIds: readonly MessageId[]
  ) => Effect.Effect<ThreadChanges, MailStoreError>;
  /** Takes a deleted label off every cached copy. */
  readonly removeLabel: (
    accountId: AccountId,
    labelId: LabelId
  ) => Effect.Effect<ThreadChanges, MailStoreError>;
  /**
   * Follows a mailbox rename on the server: the mailbox, the ones under it,
   * their copies and their labels move to the new path and ids, keeping
   * sync progress and label colours.
   */
  readonly renameLabel: (
    accountId: AccountId,
    rename: LabelRename
  ) => Effect.Effect<ThreadChanges, MailStoreError>;
  /**
   * Lists again the conversations a row files under Trash or Spam against
   * the rule in `listing.ts`: ones with mail outside Trash, or with mail in
   * the Inbox. A row is rebuilt only when one of its messages changes, so
   * rows written before that rule would keep such mail out of the Inbox
   * until then.
   */
  readonly relistHidden: (
    accountId: AccountId
  ) => Effect.Effect<ThreadChanges, MailStoreError>;
  /** Removes copies; their messages stay until `collectOrphans`. */
  readonly removeLocations: (
    accountId: AccountId,
    path: string,
    uids: readonly number[]
  ) => Effect.Effect<ThreadChanges, MailStoreError>;
  /**
   * Saves the mailbox list and label catalog. Mailboxes that disappeared lose
   * their copies; their messages stay until `collectOrphans`.
   */
  readonly replaceMailboxes: (
    accountId: AccountId,
    mailboxes: readonly MailboxRecord[],
    labels: readonly UserLabel[]
  ) => Effect.Effect<ThreadChanges, MailStoreError>;
  /** Forgets a mailbox's copies and starts it again (UIDVALIDITY changed). */
  readonly resetMailbox: (
    accountId: AccountId,
    path: string,
    progress: MailboxProgress
  ) => Effect.Effect<ThreadChanges, MailStoreError>;
  readonly saveBodies: (
    accountId: AccountId,
    bodies: readonly MessageBodies[]
  ) => Effect.Effect<ThreadChanges, MailStoreError>;
  readonly threadLocations: (
    accountId: AccountId,
    threadIds: readonly ThreadId[]
  ) => Effect.Effect<readonly ThreadLocation[], MailStoreError>;
  /** Copies of a thread's messages whose bodies are not cached yet. */
  readonly threadBodyCandidates: (
    accountId: AccountId,
    threadId: ThreadId
  ) => Effect.Effect<readonly BodyCandidate[], MailStoreError>;
  /**
   * The lowest of the `count` highest cached UIDs below `below` in a mailbox,
   * so about `count` cached copies can be read as one UID range however
   * sparse the UIDs are. `undefined` when no cached copy is below `below`.
   */
  readonly uidWindowStart: (
    accountId: AccountId,
    path: string,
    below: number,
    count: number
  ) => Effect.Effect<number | undefined, MailStoreError>;
}

export class MailEngineStore extends Context.Service<
  MailEngineStore,
  MailEngineStoreService
>()("@repo/mail/MailEngineStore") {}
