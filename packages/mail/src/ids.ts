import { Schema } from "effect";

/** An account is identified by its normalized email address. */
export const AccountId = Schema.NonEmptyString.pipe(
  Schema.brand("MailAccountId")
);
export type AccountId = typeof AccountId.Type;

/** One logical email, whatever mailboxes hold copies of it. */
export const MessageId = Schema.NonEmptyString.pipe(
  Schema.brand("MailMessageId")
);
export type MessageId = typeof MessageId.Type;

export const ThreadId = Schema.NonEmptyString.pipe(
  Schema.brand("MailThreadId")
);
export type ThreadId = typeof ThreadId.Type;

export const LabelId = Schema.NonEmptyString.pipe(Schema.brand("MailLabelId"));
export type LabelId = typeof LabelId.Type;

/**
 * Label ids every provider shares. They match the strings the renderer
 * already tests for, so the interface layer passes them through unchanged.
 */
export const SystemLabel = {
  draft: LabelId.make("DRAFT"),
  important: LabelId.make("IMPORTANT"),
  inbox: LabelId.make("INBOX"),
  sent: LabelId.make("SENT"),
  spam: LabelId.make("SPAM"),
  starred: LabelId.make("STARRED"),
  trash: LabelId.make("TRASH"),
  unread: LabelId.make("UNREAD"),
} as const;

const SYSTEM_LABEL_IDS: ReadonlySet<string> = new Set(
  Object.values(SystemLabel)
);

export const isSystemLabelId = (labelId: string): boolean =>
  SYSTEM_LABEL_IDS.has(labelId);

/**
 * User labels are prefixed so a Gmail label or folder can never be mistaken
 * for a system label, whatever the user named it.
 */
const USER_LABEL_PREFIX = "u:";

export const userLabelId = (path: string): LabelId =>
  LabelId.make(`${USER_LABEL_PREFIX}${path}`);

export const userLabelPath = (labelId: string): string | undefined =>
  labelId.startsWith(USER_LABEL_PREFIX)
    ? labelId.slice(USER_LABEL_PREFIX.length)
    : undefined;

/**
 * What a mailbox is for, from its special-use attribute (RFC 6154) or, for
 * `INBOX`, its name. `none` is an ordinary folder, which becomes a user label
 * under the generic dialect.
 */
export const MailboxRole = Schema.Literals([
  "all",
  "archive",
  "drafts",
  "flagged",
  "important",
  "inbox",
  "junk",
  "none",
  "sent",
  "trash",
]);
export type MailboxRole = typeof MailboxRole.Type;

const SPECIAL_USE_ROLES = new Map<string, MailboxRole>([
  ["\\all", "all"],
  ["\\archive", "archive"],
  ["\\drafts", "drafts"],
  ["\\flagged", "flagged"],
  ["\\important", "important"],
  ["\\inbox", "inbox"],
  ["\\junk", "junk"],
  ["\\sent", "sent"],
  ["\\trash", "trash"],
]);

export const toMailboxRole = (
  path: string,
  specialUse: string | undefined
): MailboxRole => {
  if (path.toUpperCase() === "INBOX") {
    return "inbox";
  }

  return (
    (specialUse === undefined
      ? undefined
      : SPECIAL_USE_ROLES.get(specialUse.toLowerCase())) ?? "none"
  );
};
