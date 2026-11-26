import { MailProtocolError, MailboxMissingError } from "@repo/mail/errors";
import { parseMessageIds } from "@repo/mail/headers";
import { toMailboxRole } from "@repo/mail/ids";
import type { AccountId } from "@repo/mail/ids";
import type {
  FetchFields,
  FetchedMessage,
  ImapMailbox,
  ImapSession,
  MailboxSearch,
  UidSelection,
  WatchOutcome,
} from "@repo/mail/session";
import { Deferred, Effect } from "effect";

import { parseMessage, toHeaderBlock } from "./demo-mime";
import type { ParsedMessage } from "./demo-mime";

// One account's mail server, held in memory for demo mode. It answers the
// engine's IMAP port in one of two ways:
//
// - as a plain IMAP server: folders, a copy of a message per folder;
// - as Gmail: every message once in All Mail, Spam or Trash, carrying its
//   labels (`X-GM-LABELS`) and Gmail's own message and thread ids. The other
//   mailboxes it lists are names only, as the Gmail dialect reads none of
//   them.
//
// UIDs are never reused. It offers neither `IDLE` nor `CONDSTORE`, so the
// engine polls it and reads flags again, and no state has to be kept for
// either. Nothing here touches a network or a disk.

export interface DemoFolder {
  readonly path: string;
  /** False for a name that only holds other mailboxes, as `[Gmail]` does. */
  readonly selectable?: boolean;
  /** The special-use attribute that says what the folder is for. */
  readonly specialUse?: string;
}

export interface DemoServerOptions {
  readonly accountId: AccountId;
  /**
   * Whether the server keeps a copy of the mail its SMTP side accepts, as
   * Gmail and Outlook do. Otherwise the engine appends one itself.
   */
  readonly filesSentMail: boolean;
  readonly folders: readonly DemoFolder[];
  readonly isGmail: boolean;
}

/** What Gmail keeps with a message, whichever mailbox holds it. */
interface GmailIdentity {
  labels: readonly string[];
  readonly messageId: string;
  readonly threadId: string;
}

interface StoredMessage {
  flags: readonly string[];
  readonly gmail?: GmailIdentity | undefined;
  readonly internalDate: number;
  readonly message: ParsedMessage;
  readonly uid: number;
}

/** A message on its way into a mailbox, before the server numbers it. */
type Filed = Omit<StoredMessage, "uid">;

const INBOX_LABEL = "\\Inbox";
const SENT_LABEL = "\\Sent";

const withoutBrackets = (messageId: string | undefined): string | undefined =>
  parseMessageIds(messageId)[0];

interface Mailbox {
  info: ImapMailbox;
  readonly messages: Map<number, StoredMessage>;
  uidNext: number;
  readonly uidValidity: bigint;
}

const DELIMITER = "/";

const toFetched = (
  stored: StoredMessage,
  fields: FetchFields
): FetchedMessage => {
  const { message } = stored;

  return {
    envelope: fields.envelope === true ? message.envelope : undefined,
    flags: fields.flags === true ? stored.flags : [],
    gmailLabels: fields.gmail === true ? stored.gmail?.labels : undefined,
    gmailMessageId: fields.gmail === true ? stored.gmail?.messageId : undefined,
    gmailThreadId: fields.gmail === true ? stored.gmail?.threadId : undefined,
    headers:
      fields.headers === undefined
        ? undefined
        : toHeaderBlock(message.headers, fields.headers),
    internalDate:
      fields.internalDate === true ? stored.internalDate : undefined,
    sections:
      fields.sections === undefined
        ? undefined
        : new Map(
            fields.sections.flatMap((section) => {
              const bytes = message.sections.get(section);

              return bytes === undefined ? [] : [[section, bytes] as const];
            })
          ),
    size: fields.size === true ? message.size : undefined,
    structure: fields.structure === true ? message.structure : undefined,
    uid: stored.uid,
  };
};

const matches = (stored: StoredMessage, search: MailboxSearch): boolean => {
  switch (search.kind) {
    case "all": {
      return true;
    }

    case "uidRange": {
      return stored.uid >= search.from && stored.uid <= search.to;
    }

    case "header": {
      const name = search.name.toLowerCase();

      return stored.message.headers.some(
        (header) =>
          header.name.toLowerCase() === name && header.value === search.value
      );
    }

    case "gmailMessage": {
      return stored.gmail?.messageId === search.messageId;
    }

    case "gmailThread": {
      return stored.gmail?.threadId === search.threadId;
    }

    case "gmailRaw": {
      // Only the `rfc822msgid:` operator, which is all the engine sends.
      const wanted = /^rfc822msgid:(?<id>\S+)$/u.exec(search.query)?.groups?.id;

      return (
        stored.gmail !== undefined &&
        wanted !== undefined &&
        withoutBrackets(stored.message.envelope.messageId) ===
          withoutBrackets(wanted)
      );
    }

    // Text search is not offered.
    default: {
      return false;
    }
  }
};

const isSelected = (stored: StoredMessage, selection: UidSelection): boolean =>
  selection.kind === "uids"
    ? selection.uids.includes(stored.uid)
    : stored.uid >= selection.from &&
      (selection.to === undefined || stored.uid <= selection.to);

export interface DemoDelivery {
  readonly flags: readonly string[];
  /** On Gmail, the labels the message carries, such as `\\Inbox`. */
  readonly gmailLabels?: readonly string[];
  /** On Gmail, the conversation it belongs to; its own when left out. */
  readonly gmailThreadId?: string;
  readonly internalDate: number;
}

export interface DemoMailServer {
  /**
   * Takes a message its account sent, as the provider's SMTP server does,
   * and keeps a copy where the provider keeps sent mail, if it keeps one.
   */
  readonly acceptSent: (raw: Uint8Array) => void;
  /** Files a message in a mailbox, as delivery or another client would. */
  readonly deliver: (
    path: string,
    raw: Uint8Array,
    options: DemoDelivery
  ) => void;
  readonly session: () => ImapSession;
}

export const makeDemoMailServer = ({
  accountId,
  filesSentMail,
  folders,
  isGmail,
}: DemoServerOptions): DemoMailServer => {
  const mailboxes = new Map<string, Mailbox>();
  // Each mailbox gets a UIDVALIDITY of its own, as on a server.
  let nextValidity = 1n;
  // Gmail numbers messages and conversations from one sequence.
  let nextGmailId = 1_800_000_000_000_000_000n;

  const addMailbox = ({
    path,
    selectable = true,
    specialUse,
  }: DemoFolder): void => {
    mailboxes.set(path, {
      info: {
        delimiter: DELIMITER,
        flags: [
          ...(selectable ? [] : ["\\Noselect"]),
          ...(specialUse === undefined ? [] : [specialUse]),
        ],
        path,
        role: toMailboxRole(path, specialUse),
        selectable,
      },
      messages: new Map(),
      uidNext: 1,
      uidValidity: nextValidity,
    });
    nextValidity += 1n;
  };

  for (const folder of folders) {
    addMailbox(folder);
  }

  const store = (mailbox: Mailbox, filed: Filed): void => {
    const uid = mailbox.uidNext;
    mailbox.uidNext += 1;
    mailbox.messages.set(uid, { ...filed, uid });
  };

  const mailboxWithRole = (role: ImapMailbox["role"]): Mailbox | undefined =>
    mailboxes.values().find((mailbox) => mailbox.info.role === role);

  /** The conversation a reply belongs to, from the mail it answers. */
  const gmailThreadOf = (message: ParsedMessage): string | undefined => {
    const answered = new Set(
      parseMessageIds(
        [
          message.envelope.inReplyTo,
          ...message.headers
            .filter((header) => header.name.toLowerCase() === "references")
            .map((header) => header.value),
        ].join(" ")
      )
    );

    for (const mailbox of mailboxes.values()) {
      for (const stored of mailbox.messages.values()) {
        const id = withoutBrackets(stored.message.envelope.messageId);

        if (
          stored.gmail !== undefined &&
          id !== undefined &&
          answered.has(id)
        ) {
          return stored.gmail.threadId;
        }
      }
    }

    return undefined;
  };

  /** A new message as Gmail keeps it: numbered, threaded and labelled. */
  const toGmail = (
    message: ParsedMessage,
    labels: readonly string[],
    threadId: string | undefined
  ): GmailIdentity => {
    nextGmailId += 1n;
    const messageId = String(nextGmailId);

    return {
      labels,
      messageId,
      threadId: threadId ?? gmailThreadOf(message) ?? messageId,
    };
  };

  /** Rewrites labels everywhere, as Gmail does on a rename or a delete. */
  const relabel = (change: (label: string) => string | undefined): void => {
    for (const mailbox of mailboxes.values()) {
      for (const stored of mailbox.messages.values()) {
        if (stored.gmail !== undefined) {
          stored.gmail.labels = stored.gmail.labels.flatMap((label) => {
            const next = change(label);

            return next === undefined ? [] : [next];
          });
        }
      }
    }
  };

  const refused = (): MailProtocolError =>
    new MailProtocolError({
      accountId,
      message: "The mail server refused the request",
    });

  const inMailbox = <A>(
    path: string,
    run: (mailbox: Mailbox) => A
  ): Effect.Effect<A, MailboxMissingError> =>
    Effect.suspend(() => {
      const mailbox = mailboxes.get(path);

      return mailbox === undefined
        ? Effect.fail(new MailboxMissingError({ accountId, path }))
        : Effect.sync(() => run(mailbox));
    });

  /**
   * A call that names messages by UID runs only in the mailbox those UIDs
   * were read from: one made again under the same name numbers its mail
   * afresh.
   */
  const selected = <A>(
    path: string,
    uidValidity: bigint,
    run: (mailbox: Mailbox) => A
  ): Effect.Effect<A, MailboxMissingError> =>
    Effect.suspend(() => {
      const mailbox = mailboxes.get(path);

      return mailbox === undefined || mailbox.uidValidity !== uidValidity
        ? Effect.fail(new MailboxMissingError({ accountId, path }))
        : Effect.sync(() => run(mailbox));
    });

  /** Copies into `destination`, which a server refuses when it is gone. */
  const copyTo = (
    path: string,
    uidValidity: bigint,
    uids: readonly number[],
    destination: string,
    removeOriginals: boolean
  ) =>
    Effect.suspend(
      (): Effect.Effect<void, MailProtocolError | MailboxMissingError> => {
        // Gmail's Inbox is a label: mail moved there is filed in All Mail.
        const toGmailInbox = isGmail && destination.toUpperCase() === "INBOX";

        const target = toGmailInbox
          ? mailboxWithRole("all")
          : mailboxes.get(destination);

        if (target === undefined) {
          return Effect.fail(refused());
        }

        return selected(path, uidValidity, (mailbox) => {
          for (const uid of uids) {
            const stored = mailbox.messages.get(uid);

            if (stored === undefined) {
              continue;
            }

            store(target, {
              flags: stored.flags,
              // Its own copy of the labels: each copy is relabelled alone.
              gmail:
                stored.gmail === undefined
                  ? undefined
                  : {
                      ...stored.gmail,
                      labels: toGmailInbox
                        ? [...new Set([...stored.gmail.labels, INBOX_LABEL])]
                        : stored.gmail.labels,
                    },
              internalDate: stored.internalDate,
              message: stored.message,
            });

            if (removeOriginals) {
              mailbox.messages.delete(uid);
            }
          }
        });
      }
    );

  const renameMailbox = (path: string, destination: string): void => {
    const renamed = (name: string): string =>
      name === path || name.startsWith(`${path}${DELIMITER}`)
        ? `${destination}${name.slice(path.length)}`
        : name;

    // Listed first: the loop moves entries of the map it reads.
    const moving = mailboxes
      .entries()
      .filter(([name]) => renamed(name) !== name)
      .toArray();

    for (const [name, mailbox] of moving) {
      mailboxes.delete(name);
      mailbox.info = { ...mailbox.info, path: renamed(name) };
      mailboxes.set(renamed(name), mailbox);
    }

    relabel(renamed);
  };

  /** A message as it enters a mailbox from outside the server. */
  const file = (
    mailbox: Mailbox,
    raw: Uint8Array,
    { flags, gmailLabels = [], gmailThreadId, internalDate }: DemoDelivery
  ): void => {
    const message = parseMessage(raw);

    store(mailbox, {
      flags,
      gmail: isGmail ? toGmail(message, gmailLabels, gmailThreadId) : undefined,
      internalDate,
      message,
    });
  };

  const session: ImapSession = {
    append: (path, message, flags) =>
      inMailbox(path, (mailbox) => {
        file(mailbox, message, { flags, internalDate: Date.now() });
      }),
    capabilities: new Set([
      "IMAP4rev1",
      "MOVE",
      "SPECIAL-USE",
      "UIDPLUS",
      ...(isGmail ? ["X-GM-EXT-1"] : []),
    ]),
    copy: (path, uidValidity, uids, destination) =>
      copyTo(path, uidValidity, uids, destination, false),
    createMailbox: (path) =>
      Effect.suspend(() => {
        if (mailboxes.has(path)) {
          return Effect.fail(refused());
        }

        addMailbox({ path });

        return Effect.void;
      }),
    deleteMailbox: (path) =>
      inMailbox(path, () => {
        mailboxes.delete(path);
        // A deleted Gmail label comes off its mail, which stays in All Mail.
        relabel((label) => (label === path ? undefined : label));
      }),
    expunge: (path, uidValidity, uids) =>
      selected(path, uidValidity, (mailbox) => {
        for (const uid of uids) {
          mailbox.messages.delete(uid);
        }
      }),
    fetch: (path, uidValidity, selection, fields) =>
      selected(path, uidValidity, (mailbox) =>
        [...mailbox.messages.values()]
          .filter((stored) => isSelected(stored, selection))
          .toSorted((left, right) => left.uid - right.uid)
          .map((stored) => toFetched(stored, fields))
      ),
    fetchSection: (path, uidValidity, uid, section) =>
      selected(path, uidValidity, (mailbox) =>
        mailbox.messages.get(uid)?.message.sections.get(section)
      ),
    hasMessage: (path, search) =>
      inMailbox(path, (mailbox) =>
        [...mailbox.messages.values()].some((stored) => matches(stored, search))
      ),
    listMailboxes: Effect.sync(() =>
      [...mailboxes.values()].map((mailbox) => mailbox.info)
    ),
    move: (path, uidValidity, uids, destination) =>
      copyTo(path, uidValidity, uids, destination, true),
    renameMailbox: (path, destination) =>
      Effect.suspend(() => {
        if (!mailboxes.has(path) || mailboxes.has(destination)) {
          return Effect.fail(refused());
        }

        renameMailbox(path, destination);

        return Effect.void;
      }),
    search: (path, uidValidity, search) =>
      selected(path, uidValidity, (mailbox) =>
        mailbox.messages
          .values()
          .filter((stored) => matches(stored, search))
          .map((stored) => stored.uid)
          .toArray()
          .toSorted((left, right) => left - right)
      ),
    setFlags: (path, uidValidity, uids, operation, flags) =>
      selected(path, uidValidity, (mailbox) => {
        for (const uid of uids) {
          const stored = mailbox.messages.get(uid);

          if (stored !== undefined) {
            stored.flags =
              operation === "add"
                ? [...new Set([...stored.flags, ...flags])]
                : stored.flags.filter((flag) => !flags.includes(flag));
          }
        }
      }),
    setGmailLabels: (path, uidValidity, uids, operation, labels) =>
      selected(path, uidValidity, (mailbox) => {
        for (const uid of uids) {
          const gmail = mailbox.messages.get(uid)?.gmail;

          if (gmail !== undefined) {
            gmail.labels =
              operation === "add"
                ? [...new Set([...gmail.labels, ...labels])]
                : gmail.labels.filter((label) => !labels.includes(label));
          }
        }
      }),
    status: (path) =>
      inMailbox(path, (mailbox) => ({
        messages: mailbox.messages.size,
        path,
        uidNext: mailbox.uidNext,
        uidValidity: mailbox.uidValidity,
        unseen: [...mailbox.messages.values()].filter(
          (stored) => !stored.flags.includes("\\Seen")
        ).length,
      })),
    // Never asked for, since `IDLE` is not offered. A wait here reports
    // nothing, as on a server where nothing happens.
    watch: (_path, options) =>
      Deferred.await(options.stop).pipe(
        Effect.timeoutOption(options.maxMs),
        Effect.as<WatchOutcome>("quiet")
      ),
  };

  return {
    acceptSent: (raw) => {
      // Gmail keeps sent mail in All Mail under a label, others in Sent.
      const mailbox = mailboxWithRole(isGmail ? "all" : "sent");

      if (filesSentMail && mailbox !== undefined) {
        file(mailbox, raw, {
          flags: ["\\Seen"],
          gmailLabels: [SENT_LABEL],
          internalDate: Date.now(),
        });
      }
    },
    deliver: (path, raw, options) => {
      const mailbox = mailboxes.get(path);

      if (mailbox === undefined) {
        throw new Error(`The demo mailbox has no folder ${path}`);
      }

      file(mailbox, raw, options);
    },
    session: () => session,
  };
};
