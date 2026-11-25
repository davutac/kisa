import { describe, expect, it } from "vitest";

import { genericDialect, gmailDialect } from "../src/dialects";
import { toMailboxRole } from "../src/ids";
import type {
  FetchedMessage,
  ImapMailbox,
  MessageEnvelope,
} from "../src/session";

const mailbox = (
  path: string,
  specialUse?: string,
  options: { delimiter?: string; selectable?: boolean } = {}
): ImapMailbox => ({
  delimiter: options.delimiter ?? "/",
  flags: [],
  path,
  role: toMailboxRole(path, specialUse),
  selectable: options.selectable ?? true,
});

const envelope = (
  overrides: Partial<MessageEnvelope> = {}
): MessageEnvelope => ({
  bcc: [],
  cc: [],
  from: [{ address: "Ann@Example.com", name: "Ann" }],
  replyTo: [],
  sender: [],
  to: [],
  ...overrides,
});

const message = (overrides: Partial<FetchedMessage> = {}): FetchedMessage => ({
  flags: ["\\Seen"],
  uid: 1,
  ...overrides,
});

const GMAIL_ALL_MAIL = mailbox("[Google Mail]/Alle Nachrichten", "\\All");
const GMAIL_SPAM = mailbox("[Google Mail]/Spam", "\\Junk");
const GMAIL_TRASH = mailbox("[Google Mail]/Papierkorb", "\\Trash");

const GMAIL_MAILBOXES = [
  mailbox("INBOX"),
  mailbox("[Google Mail]", undefined, { selectable: false }),
  GMAIL_ALL_MAIL,
  GMAIL_SPAM,
  GMAIL_TRASH,
  mailbox("[Google Mail]/Gesendet", "\\Sent"),
  mailbox("[Google Mail]/Markiert"),
  mailbox("Work"),
  mailbox("Work/Clients"),
];

/** One message as it would be listed in a mailbox under `uid`. */
const copyWithUid = (uid: number) =>
  message({ envelope: envelope({ messageId: "<abc@x>" }), uid });

describe("the Gmail dialect", () => {
  it("syncs All Mail, Spam and Trash whatever their localized names", () => {
    expect(
      gmailDialect.syncedMailboxes(GMAIL_MAILBOXES).map((box) => box.role)
    ).toStrictEqual(["all", "junk", "trash"]);
  });

  it("lists user labels and nothing under the localized system container", () => {
    expect(gmailDialect.userLabels(GMAIL_MAILBOXES)).toStrictEqual([
      { id: "u:Work", name: "Work", path: "Work" },
      { id: "u:Work/Clients", name: "Work/Clients", path: "Work/Clients" },
    ]);
  });

  it("uses Gmail's ids, which survive moves between mailboxes", () => {
    const fetched = message({
      gmailMessageId: "1784930285839275621",
      gmailThreadId: "1784930285839275600",
    });

    expect(gmailDialect.identify(fetched)).toStrictEqual({
      messageId: "1784930285839275621",
      threadId: "1784930285839275600",
    });
    expect(
      gmailDialect.identify(message({ gmailMessageId: "12" }))
    ).toBeUndefined();
    expect(
      gmailDialect.identify(
        message({ gmailMessageId: "x", gmailThreadId: "1" })
      )
    ).toBeUndefined();
  });

  it("maps labels, flags and the Spam and Trash mailboxes", () => {
    const fetched = message({
      flags: ["\\Flagged"],
      gmailLabels: [
        "\\Inbox",
        "\\Important",
        "\\Muted",
        "Work/Clients",
        "UNREAD",
      ],
    });

    expect(gmailDialect.locationLabels(fetched, GMAIL_ALL_MAIL)).toStrictEqual([
      "UNREAD",
      "STARRED",
      "INBOX",
      "IMPORTANT",
      "u:Work/Clients",
      "u:UNREAD",
    ]);
    expect(gmailDialect.locationLabels(message(), GMAIL_SPAM)).toStrictEqual([
      "SPAM",
    ]);
    expect(gmailDialect.locationLabels(message(), GMAIL_TRASH)).toStrictEqual([
      "TRASH",
    ]);
  });
});

// Gmail lets a user hide All Mail from mail apps ("Show in IMAP", under
// Labels in its settings). The dialect reads the account's mail from there
// alone, so without it the account would sync Spam and Trash and look done.
describe("an account whose mail the dialect cannot read", () => {
  const withoutAllMail = GMAIL_MAILBOXES.filter(
    (box) => box !== GMAIL_ALL_MAIL
  );

  it("is a Gmail account that lists no All Mail", () => {
    expect(gmailDialect.unreadable?.(GMAIL_MAILBOXES)).toBeUndefined();
    expect(gmailDialect.unreadable?.(withoutAllMail)).toMatch(/All Mail/u);
  });

  it("is a Gmail account whose All Mail cannot be opened", () => {
    expect(
      gmailDialect.unreadable?.([
        ...withoutAllMail,
        { ...GMAIL_ALL_MAIL, selectable: false },
      ])
    ).toMatch(/All Mail/u);
  });

  it("is never an account outside Gmail, which reads every folder", () => {
    expect(genericDialect.unreadable?.(withoutAllMail)).toBeUndefined();
    expect(genericDialect.unreadable?.([])).toBeUndefined();
  });
});

describe("the generic dialect", () => {
  const ICLOUD_MAILBOXES = [
    mailbox("INBOX"),
    mailbox("Sent Messages", "\\Sent"),
    mailbox("Junk", "\\Junk"),
    mailbox("Deleted Messages", "\\Trash"),
    mailbox("Archive", "\\Archive"),
    mailbox("Receipts"),
    mailbox("Parent", undefined, { selectable: false }),
  ];

  // RFC 6154 expects both to be views: the mail they show lives in other
  // folders, so a copy read there would stand in for one that is not there.
  it("leaves a server's views of mail kept elsewhere unsynced", () => {
    const withViews = [
      ...ICLOUD_MAILBOXES,
      mailbox("virtual/All", "\\All"),
      mailbox("virtual/Flagged", "\\Flagged"),
    ];

    expect(
      genericDialect.syncedMailboxes(withViews).map((box) => box.path)
    ).toStrictEqual(
      genericDialect.syncedMailboxes(ICLOUD_MAILBOXES).map((box) => box.path)
    );
    expect(genericDialect.userLabels(withViews)).toStrictEqual(
      genericDialect.userLabels(ICLOUD_MAILBOXES)
    );
  });

  it("syncs every selectable folder and turns plain folders into labels", () => {
    expect(genericDialect.syncedMailboxes(ICLOUD_MAILBOXES)).toHaveLength(6);
    expect(genericDialect.userLabels(ICLOUD_MAILBOXES)).toStrictEqual([
      { id: "u:Receipts", name: "Receipts", path: "Receipts" },
    ]);
  });

  it("normalizes other delimiters to slashes", () => {
    const dotted = mailbox("INBOX.Receipts.2024", undefined, {
      delimiter: ".",
    });

    expect(genericDialect.userLabels([dotted])).toStrictEqual([
      {
        id: "u:INBOX/Receipts/2024",
        name: "INBOX/Receipts/2024",
        path: "INBOX.Receipts.2024",
      },
    ]);
  });

  it.each([
    ["INBOX", ["\\Seen"], ["INBOX"]],
    ["INBOX", [], ["UNREAD", "INBOX"]],
    ["Sent Messages", ["\\Seen"], ["SENT"]],
    ["Junk", ["\\Seen"], ["SPAM"]],
    ["Deleted Messages", ["\\Seen"], ["TRASH"]],
    ["Archive", ["\\Seen"], []],
    ["Receipts", ["\\Seen", "\\Flagged"], ["STARRED", "u:Receipts"]],
  ])(
    "labels a copy in %s with flags %j by its folder's role",
    (path, flags, labels) => {
      const folder = ICLOUD_MAILBOXES.find(
        (candidate) => candidate.path === path
      );

      expect(folder).toBeDefined();
      expect(
        folder === undefined
          ? []
          : genericDialect.locationLabels(message({ flags }), folder)
      ).toStrictEqual(labels);
    }
  );

  it("gives every copy of a message the same id, wherever it is", () => {
    const first = genericDialect.identify(copyWithUid(1));
    const second = genericDialect.identify(copyWithUid(99));

    expect(first).toStrictEqual(second);
    expect(first?.messageId).toMatch(/^h:[\da-f]{32}$/u);
  });

  it("threads a reply and its original together in either order", () => {
    const original = message({ envelope: envelope({ messageId: "<root@x>" }) });

    const reply = message({
      envelope: envelope({ inReplyTo: "<mid@x>", messageId: "<reply@x>" }),
      headers: Buffer.from("References: <root@x>\r\n <mid@x>\r\n\r\n"),
    });

    const replyWithoutReferences = message({
      envelope: envelope({ inReplyTo: "<root@x>", messageId: "<late@x>" }),
    });

    const threadId = genericDialect.identify(original)?.threadId;
    expect(genericDialect.identify(reply)?.threadId).toBe(threadId);
    expect(genericDialect.identify(replyWithoutReferences)?.threadId).toBe(
      threadId
    );
  });

  it("identifies a message without a Message-ID from fields every copy keeps", () => {
    const bare = (uid: number) =>
      message({
        envelope: envelope({ date: 1_700_000_000_000, subject: "Hi" }),
        size: 512,
        uid,
      });

    const identity = genericDialect.identify(bare(1));

    expect(identity?.messageId).toMatch(/^h:[\da-f]{32}$/u);
    expect(identity).toStrictEqual(genericDialect.identify(bare(2)));
    expect(identity?.threadId).toBe(identity?.messageId);
    expect(genericDialect.identify(message())).toBeUndefined();
  });
});
