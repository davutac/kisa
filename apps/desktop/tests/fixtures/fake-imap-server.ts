import { MailboxMissingError } from "@repo/mail/errors";
import { AccountId, toMailboxRole } from "@repo/mail/ids";
import type { BodyStructureNode } from "@repo/mail/mime-structure";
import type {
  FetchFields,
  FetchedMessage,
  ImapMailbox,
  ImapSession,
  MailboxSearch,
  MessageEnvelope,
} from "@repo/mail/session";
import { Effect } from "effect";

/** A message as a test writes it; the server assigns UIDs and mod-sequences. */
export interface FakeMessageInput {
  readonly envelope: MessageEnvelope;
  readonly flags?: readonly string[];
  readonly gmailLabels?: readonly string[];
  readonly gmailMessageId?: string;
  readonly gmailThreadId?: string;
  /** Header fields served for `BODY.PEEK[HEADER.FIELDS (...)]`. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly internalDate: number;
  /** Raw (transfer-encoded) section contents. */
  readonly sections?: Readonly<Record<string, string>>;
  readonly size?: number;
  readonly structure?: BodyStructureNode;
}

interface StoredMessage extends FakeMessageInput {
  flags: readonly string[];
  gmailLabels?: readonly string[];
  modseq: bigint;
  uid: number;
}

interface FakeMailbox {
  readonly info: ImapMailbox;
  highestModseq: bigint;
  readonly messages: Map<number, StoredMessage>;
  uidNext: number;
  uidValidity: bigint;
}

const accountId = AccountId.make("test@example.com");

export const envelope = (
  overrides: Partial<MessageEnvelope> = {}
): MessageEnvelope => ({
  bcc: [],
  cc: [],
  from: [{ address: "sender@example.com", name: "Sender" }],
  replyTo: [],
  sender: [],
  to: [{ address: "test@example.com" }],
  ...overrides,
});

const toFetched = (
  message: StoredMessage,
  fields: FetchFields
): FetchedMessage => {
  const headers =
    fields.headers === undefined
      ? undefined
      : Buffer.from(
          `${Object.entries(message.headers ?? {})
            .filter(
              ([name]) =>
                fields.headers === true ||
                (fields.headers ?? []).includes(name.toLowerCase())
            )
            .map(([name, value]) => `${name}: ${value}`)
            .join("\r\n")}\r\n\r\n`
        );
  const sections =
    fields.sections === undefined
      ? undefined
      : new Map(
          fields.sections.flatMap((section) => {
            const value = message.sections?.[section];
            return value === undefined
              ? []
              : [[section, Buffer.from(value, "latin1")] as const];
          })
        );

  return {
    envelope: fields.envelope === true ? message.envelope : undefined,
    flags: fields.flags === true ? message.flags : [],
    gmailLabels: fields.gmail === true ? message.gmailLabels : undefined,
    gmailMessageId: fields.gmail === true ? message.gmailMessageId : undefined,
    gmailThreadId: fields.gmail === true ? message.gmailThreadId : undefined,
    headers,
    internalDate:
      fields.internalDate === true ? message.internalDate : undefined,
    modseq: message.modseq,
    sections,
    size: fields.size === true ? (message.size ?? 1000) : undefined,
    structure: fields.structure === true ? message.structure : undefined,
    uid: message.uid,
  };
};

const searchMailbox = (
  mailbox: FakeMailbox,
  search: MailboxSearch
): readonly number[] => {
  const messages = [...mailbox.messages.values()];
  const matching = messages.filter((message) => {
    switch (search.kind) {
      case "all": {
        return true;
      }
      case "uidRange": {
        return message.uid >= search.from && message.uid <= search.to;
      }
      case "gmailThread": {
        return message.gmailThreadId === search.threadId;
      }
      case "gmailMessage": {
        return message.gmailMessageId === search.messageId;
      }
      case "gmailRaw": {
        // Only the `rfc822msgid:` operator the engine uses.
        const [, wanted] = /^rfc822msgid:(?<id>\S+)$/u.exec(search.query) ?? [];
        return wanted !== undefined && message.envelope.messageId === wanted;
      }
      case "header": {
        return search.name.toLowerCase() === "message-id"
          ? message.envelope.messageId === search.value
          : message.headers?.[search.name.toLowerCase()] === search.value;
      }
      default: {
        return false;
      }
    }
  });
  return matching
    .map((message) => message.uid)
    .toSorted((left, right) => left - right);
};

/** Reads the few headers the fake needs from a message a client appended. */
const parseAppended = (raw: string, flags: readonly string[]) => {
  const [head = ""] = raw.split("\r\n\r\n");
  const headers = new Map<string, string>();
  for (const line of head.replaceAll(/\r\n[ \t]/gu, " ").split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon > 0) {
      headers.set(
        line.slice(0, colon).toLowerCase(),
        line.slice(colon + 1).trim()
      );
    }
  }
  return {
    envelope: envelope({
      from: [{ address: "test@example.com" }],
      messageId: headers.get("message-id"),
      subject: headers.get("subject"),
    }),
    flags,
    internalDate: Date.now(),
  } satisfies FakeMessageInput;
};

export class FakeImapServer {
  /** Messages clients stored with APPEND, as sent. */
  readonly appended: { flags: readonly string[]; path: string; raw: string }[] =
    [];
  readonly calls: string[] = [];
  readonly capabilities: ReadonlySet<string>;
  /**
   * Gmail files a message moved into INBOX in All Mail with the `\Inbox`
   * label. Set to the All Mail path to behave that way.
   */
  private readonly gmailAllMail: string | undefined;
  private readonly mailboxes = new Map<string, FakeMailbox>();
  private modseq = 100n;

  constructor(
    mailboxes: readonly {
      readonly delimiter?: string;
      readonly path: string;
      readonly selectable?: boolean;
      readonly specialUse?: string;
    }[],
    capabilities: readonly string[] = ["CONDSTORE", "IDLE", "X-GM-EXT-1"],
    gmailAllMail?: string
  ) {
    this.capabilities = new Set(capabilities);
    this.gmailAllMail = gmailAllMail;
    for (const mailbox of mailboxes) {
      this.mailboxes.set(mailbox.path, {
        highestModseq: this.modseq,
        info: {
          delimiter: mailbox.delimiter ?? "/",
          flags: mailbox.selectable === false ? ["\\Noselect"] : [],
          path: mailbox.path,
          role: toMailboxRole(mailbox.path, mailbox.specialUse),
          selectable: mailbox.selectable ?? true,
        },
        messages: new Map(),
        uidNext: 1,
        uidValidity: 7n,
      });
    }
  }

  /** A mailbox created by a client (a new label or folder). */
  addMailbox(path: string, specialUse?: string): void {
    this.mailboxes.set(path, {
      highestModseq: this.modseq,
      info: {
        delimiter: "/",
        flags: [],
        path,
        role: toMailboxRole(path, specialUse),
        selectable: true,
      },
      messages: new Map(),
      uidNext: 1,
      uidValidity: 7n,
    });
  }

  private mailbox(path: string): FakeMailbox {
    const mailbox = this.mailboxes.get(path);
    if (mailbox === undefined) {
      throw new Error(`no mailbox ${path}`);
    }
    return mailbox;
  }

  private nextModseq(mailbox: FakeMailbox): bigint {
    this.modseq += 1n;
    mailbox.highestModseq = this.modseq;
    return this.modseq;
  }

  /** Delivers a message and returns its UID. */
  deliver(path: string, input: FakeMessageInput): number {
    const mailbox = this.mailbox(path);
    const uid = mailbox.uidNext;
    mailbox.uidNext += 1;
    mailbox.messages.set(uid, {
      ...input,
      flags: input.flags ?? [],
      gmailLabels: input.gmailLabels,
      modseq: this.nextModseq(mailbox),
      uid,
    });
    return uid;
  }

  /** Leaves a gap in the UID space, as servers do after expunges. */
  skipUids(path: string, count: number): void {
    this.mailbox(path).uidNext += count;
  }

  setFlags(path: string, uid: number, flags: readonly string[]): void {
    const mailbox = this.mailbox(path);
    const message = mailbox.messages.get(uid);
    if (message !== undefined) {
      message.flags = flags;
      message.modseq = this.nextModseq(mailbox);
    }
  }

  setGmailLabels(path: string, uid: number, labels: readonly string[]): void {
    const mailbox = this.mailbox(path);
    const message = mailbox.messages.get(uid);
    if (message !== undefined) {
      message.gmailLabels = labels;
      message.modseq = this.nextModseq(mailbox);
    }
  }

  expunge(path: string, uid: number): void {
    this.mailbox(path).messages.delete(uid);
  }

  /** Moves a copy: it leaves `from` and arrives in `to` under a new UID. */
  move(from: string, uid: number, to: string): number {
    const message = this.mailbox(from).messages.get(uid);
    if (message === undefined) {
      throw new Error("no such message");
    }
    this.expunge(from, uid);
    return this.deliver(to, message);
  }

  /** Rewrites Gmail labels everywhere, as Gmail does on rename or delete. */
  private relabel(change: (label: string) => string | undefined): void {
    for (const mailbox of this.mailboxes.values()) {
      for (const message of mailbox.messages.values()) {
        if (message.gmailLabels !== undefined) {
          message.gmailLabels = message.gmailLabels.flatMap((label) => {
            const next = change(label);
            return next === undefined ? [] : [next];
          });
        }
      }
    }
  }

  resetUidValidity(path: string): void {
    const mailbox = this.mailbox(path);
    const messages = [...mailbox.messages.values()];
    mailbox.messages.clear();
    mailbox.uidValidity += 1n;
    mailbox.uidNext = 1;
    for (const message of messages) {
      this.deliver(path, message);
    }
  }

  session(): ImapSession {
    const withMailbox = <A>(path: string, run: (mailbox: FakeMailbox) => A) =>
      Effect.suspend(() => {
        const mailbox = this.mailboxes.get(path);
        return mailbox === undefined
          ? Effect.fail(new MailboxMissingError({ accountId, path }))
          : Effect.sync(() => run(mailbox));
      });

    const copyInto = (
      mailbox: FakeMailbox,
      uids: readonly number[],
      destination: string
    ): void => {
      for (const uid of uids) {
        const message = mailbox.messages.get(uid);
        if (message === undefined) {
          continue;
        }
        if (this.gmailAllMail !== undefined && destination === "INBOX") {
          this.deliver(this.gmailAllMail, {
            ...message,
            gmailLabels: [
              ...new Set([...(message.gmailLabels ?? []), "\\Inbox"]),
            ],
          });
        } else {
          this.deliver(destination, message);
        }
      }
    };

    return {
      append: (path, message, flags) =>
        withMailbox(path, () => {
          const raw = Buffer.from(message).toString("utf-8");
          this.calls.push(`append ${path}`);
          this.appended.push({ flags, path, raw });
          this.deliver(path, parseAppended(raw, flags));
        }),
      capabilities: this.capabilities,
      copy: (path, uids, destination) =>
        withMailbox(path, (mailbox) => {
          this.calls.push(`copy ${path} -> ${destination}`);
          copyInto(mailbox, uids, destination);
        }),
      createMailbox: (path) =>
        Effect.sync(() => {
          this.calls.push(`create ${path}`);
          this.addMailbox(path);
        }),
      deleteMailbox: (path) =>
        Effect.sync(() => {
          this.calls.push(`delete ${path}`);
          this.mailboxes.delete(path);
          // Gmail takes a deleted label off its messages without a new
          // mod-sequence.
          this.relabel((label) => (label === path ? undefined : label));
        }),
      expunge: (path, uids) =>
        withMailbox(path, (mailbox) => {
          this.calls.push(`expunge ${path}`);
          for (const uid of uids) {
            mailbox.messages.delete(uid);
          }
        }),
      fetch: (path, selection, fields, options) =>
        withMailbox(path, (mailbox) => {
          this.calls.push(`fetch ${path}`);
          const uids =
            selection.kind === "uids" ? new Set(selection.uids) : undefined;
          return [...mailbox.messages.values()]
            .filter((message) =>
              uids === undefined
                ? selection.kind === "range" &&
                  message.uid >= selection.from &&
                  (selection.to === undefined || message.uid <= selection.to)
                : uids.has(message.uid)
            )
            .filter(
              (message) =>
                options?.changedSince === undefined ||
                message.modseq > options.changedSince
            )
            .toSorted((left, right) => left.uid - right.uid)
            .map((message) => toFetched(message, fields));
        }),
      fetchSection: (path, uid, section) =>
        withMailbox(path, (mailbox) => {
          const value = mailbox.messages.get(uid)?.sections?.[section];
          return value === undefined ? undefined : Buffer.from(value, "latin1");
        }),
      listMailboxes: Effect.sync(() =>
        [...this.mailboxes.values()].map((mailbox) => mailbox.info)
      ),
      move: (path, uids, destination) =>
        withMailbox(path, (mailbox) => {
          this.calls.push(`move ${path} -> ${destination}`);
          copyInto(mailbox, uids, destination);
          for (const uid of uids) {
            mailbox.messages.delete(uid);
          }
        }),
      renameMailbox: (path, destination) =>
        Effect.sync(() => {
          this.calls.push(`rename ${path} -> ${destination}`);
          const renamed = (name: string): string =>
            name === path || name.startsWith(`${path}/`)
              ? `${destination}${name.slice(path.length)}`
              : name;
          // Mailboxes under it move with it, keeping UIDVALIDITY.
          const before = [...this.mailboxes];
          for (const [name, mailbox] of before) {
            if (renamed(name) !== name) {
              this.mailboxes.delete(name);
              this.mailboxes.set(renamed(name), {
                ...mailbox,
                info: { ...mailbox.info, path: renamed(name) },
              });
            }
          }
          this.relabel(renamed);
        }),
      search: (path, search) =>
        withMailbox(path, (mailbox) => {
          this.calls.push(`search ${path} ${search.kind}`);
          return searchMailbox(mailbox, search);
        }),
      setFlags: (path, uids, operation, flags) =>
        withMailbox(path, (mailbox) => {
          this.calls.push(`store ${path} ${operation} ${flags.join(" ")}`);
          for (const uid of uids) {
            const message = mailbox.messages.get(uid);
            if (message !== undefined) {
              this.setFlags(
                path,
                uid,
                operation === "add"
                  ? [...new Set([...message.flags, ...flags])]
                  : message.flags.filter((flag) => !flags.includes(flag))
              );
            }
          }
        }),
      setGmailLabels: (path, uids, operation, labels) =>
        withMailbox(path, (mailbox) => {
          this.calls.push(`label ${path} ${operation} ${labels.join(" ")}`);
          for (const uid of uids) {
            const message = mailbox.messages.get(uid);
            if (message !== undefined) {
              const current = message.gmailLabels ?? [];
              this.setGmailLabels(
                path,
                uid,
                operation === "add"
                  ? [...new Set([...current, ...labels])]
                  : current.filter((label) => !labels.includes(label))
              );
            }
          }
        }),
      status: (path) =>
        withMailbox(path, (mailbox) => ({
          highestModseq: this.capabilities.has("CONDSTORE")
            ? mailbox.highestModseq
            : undefined,
          messages: mailbox.messages.size,
          path,
          uidNext: mailbox.uidNext,
          uidValidity: mailbox.uidValidity,
        })),
    };
  }
}
