import { createHash } from "node:crypto";

import { getHeaderValue, parseHeaderBlock, parseMessageIds } from "./headers";
import { MessageId, SystemLabel, ThreadId, userLabelId } from "./ids";
import type { LabelId, MailboxRole } from "./ids";
import type { FetchFields, FetchedMessage, ImapMailbox } from "./session";

export type DialectKind = "generic" | "gmail";

export interface MessageIdentity {
  readonly messageId: MessageId;
  readonly threadId: ThreadId;
}

export interface UserLabel {
  readonly id: LabelId;
  readonly name: string;
  /** The mailbox that holds the label's messages. */
  readonly path: string;
}

/**
 * The provider-specific part of the engine: which mailboxes to read, and how
 * a server's messages map to Kisa's message, thread and label ids. See
 * docs/architecture/mail-engine.md.
 */
export interface Dialect {
  readonly kind: DialectKind;
  /** `undefined` when the server sent too little to identify the message. */
  readonly identify: (message: FetchedMessage) => MessageIdentity | undefined;
  /** The labels one copy of a message contributes to it. */
  readonly locationLabels: (
    message: FetchedMessage,
    mailbox: ImapMailbox
  ) => readonly LabelId[];
  /** What the skeleton asks for: enough to list, thread and label a message. */
  readonly skeletonFields: FetchFields;
  readonly syncedMailboxes: (
    mailboxes: readonly ImapMailbox[]
  ) => readonly ImapMailbox[];
  /**
   * Why the account's mail cannot be read from the mailboxes its server
   * lists, in fixed words for the user, or `undefined` when it can. Left out
   * by a dialect that reads every folder: no one folder's absence hides its
   * account.
   */
  readonly unreadable?: (
    mailboxes: readonly ImapMailbox[]
  ) => string | undefined;
  readonly userLabels: (
    mailboxes: readonly ImapMailbox[]
  ) => readonly UserLabel[];
}

const flagLabels = (flags: readonly string[]): readonly LabelId[] => {
  const lowerFlags = new Set(flags.map((flag) => flag.toLowerCase()));
  const labels: LabelId[] = [];

  if (!lowerFlags.has("\\seen")) {
    labels.push(SystemLabel.unread);
  }
  if (lowerFlags.has("\\flagged")) {
    labels.push(SystemLabel.starred);
  }
  if (lowerFlags.has("\\draft")) {
    labels.push(SystemLabel.draft);
  }

  return labels;
};

const ROLE_LABELS = new Map<MailboxRole, LabelId>([
  ["drafts", SystemLabel.draft],
  ["inbox", SystemLabel.inbox],
  ["junk", SystemLabel.spam],
  ["sent", SystemLabel.sent],
  ["trash", SystemLabel.trash],
]);

const unique = (labels: readonly LabelId[]): readonly LabelId[] => [
  ...new Set(labels),
];

const isSelectable = (mailbox: ImapMailbox): boolean => mailbox.selectable;

// ---------------------------------------------------------------- Gmail

const GMAIL_ID_PATTERN = /^\d{1,20}$/u;

const GMAIL_SYSTEM_LABELS = new Map<string, LabelId>([
  ["\\draft", SystemLabel.draft],
  ["\\important", SystemLabel.important],
  ["\\inbox", SystemLabel.inbox],
  ["\\sent", SystemLabel.sent],
  ["\\starred", SystemLabel.starred],
]);

const GMAIL_SYNCED_ROLES: ReadonlySet<MailboxRole> = new Set([
  "all",
  "junk",
  "trash",
]);

/**
 * Gmail keeps its special folders under one container whose name is
 * localized (`[Gmail]`, `[Google Mail]`). It is the parent of the All Mail
 * folder, and nothing under it is a user label.
 */
const gmailSystemContainer = (
  mailboxes: readonly ImapMailbox[]
): string | undefined => {
  const allMail = mailboxes.find((mailbox) => mailbox.role === "all");

  if (allMail === undefined) {
    return;
  }

  const separator = allMail.path.lastIndexOf(allMail.delimiter);
  return separator > 0 ? allMail.path.slice(0, separator) : undefined;
};

/**
 * Said when a Gmail account lists no All Mail, the one mailbox its mail is
 * read from. Gmail lets a user leave a label out of what mail apps see
 * ("Show in IMAP", under Labels in its settings), and guides for other mail
 * apps recommend it for All Mail. The words start from what Kisa sees and
 * name the setting as the remedy: that Gmail drops a hidden All Mail from
 * its list is how the setting is documented, and has not been tried here.
 */
export const GMAIL_ALL_MAIL_HIDDEN =
  "Gmail is not showing All Mail to Kisa, and that is where this account's mail is read from. In Gmail's settings, open Labels and turn on \"Show in IMAP\" for All Mail.";

export const gmailDialect: Dialect = {
  identify: (message) =>
    message.gmailMessageId !== undefined &&
    message.gmailThreadId !== undefined &&
    GMAIL_ID_PATTERN.test(message.gmailMessageId) &&
    GMAIL_ID_PATTERN.test(message.gmailThreadId)
      ? {
          messageId: MessageId.make(message.gmailMessageId),
          threadId: ThreadId.make(message.gmailThreadId),
        }
      : undefined,
  kind: "gmail",
  locationLabels: (message, mailbox) => {
    const labels: LabelId[] = [...flagLabels(message.flags)];

    for (const label of message.gmailLabels ?? []) {
      if (label.startsWith("\\")) {
        const system = GMAIL_SYSTEM_LABELS.get(label.toLowerCase());
        if (system !== undefined) {
          labels.push(system);
        }
      } else if (label.length > 0) {
        labels.push(userLabelId(label));
      }
    }

    if (mailbox.role === "junk") {
      labels.push(SystemLabel.spam);
    } else if (mailbox.role === "trash") {
      labels.push(SystemLabel.trash);
    }

    return unique(labels);
  },
  skeletonFields: {
    envelope: true,
    flags: true,
    gmail: true,
    internalDate: true,
    size: true,
  },
  syncedMailboxes: (mailboxes) =>
    mailboxes.filter(
      (mailbox) => isSelectable(mailbox) && GMAIL_SYNCED_ROLES.has(mailbox.role)
    ),
  unreadable: (mailboxes) =>
    mailboxes.some((mailbox) => mailbox.role === "all" && isSelectable(mailbox))
      ? undefined
      : GMAIL_ALL_MAIL_HIDDEN,
  userLabels: (mailboxes) => {
    const container = gmailSystemContainer(mailboxes);

    return mailboxes
      .filter(
        (mailbox) =>
          mailbox.role === "none" &&
          mailbox.path !== container &&
          (container === undefined ||
            !mailbox.path.startsWith(`${container}${mailbox.delimiter}`))
      )
      .map((mailbox) => ({
        id: userLabelId(mailbox.path),
        name: mailbox.path,
        path: mailbox.path,
      }));
  },
};

// -------------------------------------------------------------- Generic

const hashId = (kind: string, value: string): string =>
  `h:${createHash("sha256").update(`${kind}\u0000${value}`).digest("hex").slice(0, 32)}`;

const firstAddress = (message: FetchedMessage): string =>
  message.envelope?.from[0]?.address?.toLowerCase() ?? "";

/**
 * Generic servers have no stable message id, so one is derived from the
 * `Message-ID` header. A message without one hashes the fields a copy keeps
 * wherever it is moved, so every copy hashes the same way.
 */
const genericMessageId = (message: FetchedMessage): MessageId => {
  const [headerId] = parseMessageIds(message.envelope?.messageId);

  if (headerId !== undefined) {
    return MessageId.make(hashId("id", headerId));
  }

  return MessageId.make(
    hashId(
      "fallback",
      [
        String(message.envelope?.date ?? ""),
        firstAddress(message),
        message.envelope?.subject ?? "",
        String(message.size ?? ""),
      ].join("\u0000")
    )
  );
};

/**
 * The first `References` entry names the conversation's root, so a reply and
 * its original reach the same thread id in whichever order they arrive.
 */
const genericThreadId = (
  message: FetchedMessage,
  messageId: MessageId
): ThreadId => {
  const headers =
    message.headers === undefined ? [] : parseHeaderBlock(message.headers);
  const [root] = parseMessageIds(getHeaderValue(headers, "references"));
  const [parent] = parseMessageIds(message.envelope?.inReplyTo);
  const [own] = parseMessageIds(message.envelope?.messageId);
  const anchor = root ?? parent ?? own;

  return ThreadId.make(anchor === undefined ? messageId : hashId("id", anchor));
};

const normalizeFolderName = (mailbox: ImapMailbox): string =>
  mailbox.delimiter.length > 0 && mailbox.delimiter !== "/"
    ? mailbox.path.split(mailbox.delimiter).join("/")
    : mailbox.path;

/**
 * Mailboxes a server marks `\All` or `\Flagged`. RFC 6154 expects both to
 * be views of mail that lives in other mailboxes, so the generic dialect
 * does not read them: what such a view shows is no second copy, and counting
 * it as one would let a label's removal delete the only copy there is. The
 * marks come from the server alone, never from a folder's name.
 */
const VIEW_ROLES: ReadonlySet<MailboxRole> = new Set(["all", "flagged"]);

export const genericDialect: Dialect = {
  identify: (message) => {
    if (message.envelope === undefined) {
      return;
    }

    const messageId = genericMessageId(message);
    return { messageId, threadId: genericThreadId(message, messageId) };
  },
  kind: "generic",
  locationLabels: (message, mailbox) => {
    const roleLabel = ROLE_LABELS.get(mailbox.role);
    const folderLabel =
      mailbox.role === "none"
        ? userLabelId(normalizeFolderName(mailbox))
        : undefined;

    return unique([
      ...flagLabels(message.flags),
      ...(roleLabel === undefined ? [] : [roleLabel]),
      ...(folderLabel === undefined ? [] : [folderLabel]),
    ]);
  },
  skeletonFields: {
    envelope: true,
    flags: true,
    headers: ["references"],
    internalDate: true,
    size: true,
  },
  syncedMailboxes: (mailboxes) =>
    mailboxes.filter(
      (mailbox) => isSelectable(mailbox) && !VIEW_ROLES.has(mailbox.role)
    ),
  userLabels: (mailboxes) =>
    mailboxes
      .filter((mailbox) => mailbox.role === "none" && isSelectable(mailbox))
      .map((mailbox) => {
        const name = normalizeFolderName(mailbox);
        return { id: userLabelId(name), name, path: mailbox.path };
      }),
};

export const dialects = {
  generic: genericDialect,
  gmail: gmailDialect,
} satisfies Record<DialectKind, Dialect>;
