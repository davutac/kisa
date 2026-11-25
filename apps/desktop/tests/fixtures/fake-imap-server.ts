import {
  MailConnectionError,
  MailProtocolError,
  MailboxMissingError,
} from "@repo/mail/errors";
import { AccountId, toMailboxRole } from "@repo/mail/ids";
import type { BodyStructureNode } from "@repo/mail/mime-structure";
import type {
  FetchFields,
  FetchedMessage,
  ImapMailbox,
  ImapSession,
  MailboxSearch,
  MailboxState,
  MessageEnvelope,
  UidSelection,
  WatchOptions,
  WatchOutcome,
} from "@repo/mail/session";
import { Deferred, Effect } from "effect";

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
  /** Describes the message but leaves it out of every fetch of its text. */
  readonly withholdsSections?: boolean;
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
  fields: FetchFields,
  hasModseq: boolean
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
    // A server without CONDSTORE keeps no mod-sequences.
    modseq: hasModseq ? message.modseq : undefined,
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
  /** Every FETCH, with what it asked for. */
  readonly fetches: {
    readonly changedSince?: bigint | undefined;
    readonly fields: FetchFields;
    readonly path: string;
    readonly selection: UidSelection;
  }[] = [];
  /**
   * Called with a command that changes mail just before it is applied: the
   * moment another client's change lands between a client reading its cache
   * and sending the command.
   */
  beforeCommand: ((call: string) => void) | undefined;
  /** Makes a FETCH fail as a dropped connection would, when it returns true. */
  dropFetch: ((path: string, selection: UidSelection) => boolean) | undefined;
  /**
   * Fails a STATUS instead of answering it: `refused`, as a server does for a
   * mailbox it lists and will not open, or `dropped`, as a connection lost
   * under the command.
   */
  failStatus: ((path: string) => "dropped" | "refused" | undefined) | undefined;
  /**
   * Applies a command that changes mail and then fails it, when it returns
   * true: a connection lost after the server acted and before it answered.
   */
  loseAnswer: ((call: string) => boolean) | undefined;
  /** Added to every UNSEEN count, for a server whose count is not exact. */
  miscountedUnseen = 0;
  /**
   * Called on each FETCH and SEARCH, before it is answered: the moment
   * another client's change lands in the middle of a pass.
   */
  onRead: ((path: string) => void) | undefined;
  /** Called on each STATUS, before it is answered. */
  onStatus: ((path: string) => void) | undefined;
  /** The mailbox of every STATUS, in order. */
  readonly statuses: string[] = [];
  /** The mailbox of every wait a client began (IDLE). */
  readonly watches: string[] = [];
  private onWatch: (() => void) | undefined;
  private readonly watchers = new Set<{
    readonly end: (outcome: WatchOutcome) => void;
    readonly path: string;
  }>();
  /**
   * Gmail files a message moved into INBOX in All Mail with the `\Inbox`
   * label. Set to the All Mail path to behave that way.
   */
  private readonly gmailAllMail: string | undefined;
  private readonly mailboxes = new Map<string, FakeMailbox>();
  private modseq = 100n;
  /**
   * Each mailbox gets a UIDVALIDITY of its own, as on a server, far enough
   * from the next that a rebuilt mailbox never reaches another's.
   */
  private validities = 7n;

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
        uidValidity: this.nextValidity(),
      });
    }
  }

  private nextValidity(): bigint {
    const validity = this.validities;
    this.validities += 1000n;
    return validity;
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
      uidValidity: this.nextValidity(),
    });
  }

  /**
   * A mailbox deleted, here or by another client. Gmail takes a deleted
   * label off its messages without a new mod-sequence.
   */
  removeMailbox(path: string): void {
    this.mailboxes.delete(path);
    this.relabel((label) => (label === path ? undefined : label));
  }

  /**
   * A mailbox renamed, here or by another client. Mailboxes under it move
   * with it, keeping UIDVALIDITY, and Gmail relabels the messages without a
   * new mod-sequence.
   */
  renameMailbox(path: string, destination: string): void {
    const renamed = (name: string): string =>
      name === path || name.startsWith(`${path}/`)
        ? `${destination}${name.slice(path.length)}`
        : name;
    // Copied first: the loop moves entries of the map it reads.
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
  }

  private mailbox(path: string): FakeMailbox {
    const mailbox = this.mailboxes.get(path);
    if (mailbox === undefined) {
      throw new Error(`no mailbox ${path}`);
    }
    return mailbox;
  }

  /**
   * Tells the clients waiting in `path` what happened there, as IDLE does.
   * Public for Gmail's Inbox, a view of All Mail the fake does not model:
   * a test changes All Mail and reports it for the Inbox itself.
   */
  report(path: string, outcome: "arrived" | "changed"): void {
    for (const watcher of this.watchers) {
      if (watcher.path === path) {
        watcher.end(outcome);
      }
    }
  }

  /** Lets every wait run out, as its clock would. */
  endWatches(): void {
    for (const watcher of this.watchers) {
      watcher.end("quiet");
    }
  }

  /** Resolves once a client is waiting, so a test can act on the server then. */
  nextWatch(): Promise<null> {
    const started = Promise.withResolvers<null>();
    this.onWatch = () => started.resolve(null);
    return started.promise;
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
    this.report(path, "arrived");
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
      this.report(path, "changed");
    }
  }

  /**
   * Changes a message's flags without a new mod-sequence or a report: what
   * the server holds when the cache has a flag wrong and nothing says so.
   */
  setFlagsUnreported(
    path: string,
    uid: number,
    flags: readonly string[]
  ): void {
    const message = this.mailbox(path).messages.get(uid);
    if (message !== undefined) {
      message.flags = flags;
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
    this.report(path, "changed");
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

  /** Copies a message into `to` under a new UID, as another client would. */
  copy(from: string, uid: number, to: string): number {
    const message = this.mailbox(from).messages.get(uid);
    if (message === undefined) {
      throw new Error("no such message");
    }
    return this.deliver(to, message);
  }

  /**
   * Everything the server holds, as one fetch of every message in every
   * mailbox would answer: what a cache is held against.
   */
  snapshot(fields: FetchFields): readonly {
    readonly mailbox: ImapMailbox;
    readonly messages: readonly FetchedMessage[];
    readonly uidValidity: bigint;
  }[] {
    return [...this.mailboxes.values()].map((mailbox) => ({
      mailbox: mailbox.info,
      messages: [...mailbox.messages.values()]
        .toSorted((left, right) => left.uid - right.uid)
        .map((message) =>
          toFetched(message, fields, this.capabilities.has("CONDSTORE"))
        ),
      uidValidity: mailbox.uidValidity,
    }));
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

    /**
     * A command that names messages by UID runs only in a mailbox that has
     * the caller's UIDVALIDITY, as the adapter refuses it otherwise. That is
     * looked at when the command applies, after the hooks another client's
     * change lands in: a rebuild cannot come between the two on a server.
     */
    const selected = <A>(
      path: string,
      uidValidity: bigint,
      run: (mailbox: FakeMailbox) => A
    ) =>
      Effect.suspend(() => {
        const mailbox = this.mailboxes.get(path);
        return mailbox === undefined || mailbox.uidValidity !== uidValidity
          ? Effect.fail(new MailboxMissingError({ accountId, path }))
          : Effect.sync(() => run(mailbox));
      });

    /** `onRead`, for a read of a mailbox that is there. */
    const reading = (path: string): void => {
      if (this.mailboxes.has(path)) {
        this.onRead?.(path);
      }
    };

    /**
     * A command that changes mail: see `beforeCommand` and `loseAnswer`. One
     * that files messages into a mailbox that is gone is refused, as a
     * server answers `NO` to it.
     */
    const changing = (
      call: string,
      path: string,
      uidValidity: bigint,
      apply: (mailbox: FakeMailbox) => void,
      destination?: string
    ) =>
      Effect.suspend(
        (): Effect.Effect<void, MailProtocolError | MailboxMissingError> => {
          this.beforeCommand?.(call);
          return destination !== undefined && !this.mailboxes.has(destination)
            ? Effect.fail(
                new MailProtocolError({
                  accountId,
                  message: "The mail server refused the request",
                })
              )
            : selected(path, uidValidity, (mailbox) => {
                this.calls.push(call);
                apply(mailbox);
              });
        }
      ).pipe(
        Effect.andThen(
          Effect.suspend(() =>
            this.loseAnswer?.(call) === true
              ? Effect.fail(
                  new MailConnectionError({
                    accountId,
                    message: "The connection to the mail server failed",
                  })
                )
              : Effect.void
          )
        )
      );

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
      copy: (path, uidValidity, uids, destination) =>
        changing(
          `copy ${path} -> ${destination}`,
          path,
          uidValidity,
          (mailbox) => {
            copyInto(mailbox, uids, destination);
          },
          destination
        ),
      createMailbox: (path) =>
        Effect.sync(() => {
          this.calls.push(`create ${path}`);
          this.addMailbox(path);
        }),
      deleteMailbox: (path) =>
        Effect.sync(() => {
          this.calls.push(`delete ${path}`);
          this.removeMailbox(path);
        }),
      expunge: (path, uidValidity, uids) =>
        changing(`expunge ${path}`, path, uidValidity, (mailbox) => {
          for (const uid of uids) {
            mailbox.messages.delete(uid);
          }
        }),
      fetch: (path, uidValidity, selection, fields, options) =>
        this.dropFetch?.(path, selection) === true
          ? Effect.fail(
              new MailConnectionError({
                accountId,
                message: "The connection to the mail server failed",
              })
            )
          : Effect.sync(() => {
              reading(path);
            }).pipe(
              Effect.andThen(
                selected(path, uidValidity, (mailbox) => {
                  this.calls.push(`fetch ${path}`);
                  this.fetches.push({
                    changedSince: options?.changedSince,
                    fields,
                    path,
                    selection,
                  });
                  const uids =
                    selection.kind === "uids"
                      ? new Set(selection.uids)
                      : undefined;
                  return [...mailbox.messages.values()]
                    .filter((message) =>
                      uids === undefined
                        ? selection.kind === "range" &&
                          message.uid >= selection.from &&
                          (selection.to === undefined ||
                            message.uid <= selection.to)
                        : uids.has(message.uid)
                    )
                    .filter(
                      (message) =>
                        options?.changedSince === undefined ||
                        message.modseq > options.changedSince
                    )
                    .filter(
                      (message) =>
                        fields.sections === undefined ||
                        message.withholdsSections !== true
                    )
                    .toSorted((left, right) => left.uid - right.uid)
                    .map((message) =>
                      toFetched(
                        message,
                        fields,
                        this.capabilities.has("CONDSTORE")
                      )
                    );
                })
              )
            ),
      fetchSection: (path, uidValidity, uid, section) =>
        selected(path, uidValidity, (mailbox) => {
          const value = mailbox.messages.get(uid)?.sections?.[section];
          return value === undefined ? undefined : Buffer.from(value, "latin1");
        }),
      hasMessage: (path, search) =>
        withMailbox(path, (mailbox) => {
          this.onRead?.(path);
          this.calls.push(`search ${path} ${search.kind}`);
          return searchMailbox(mailbox, search).length > 0;
        }),
      listMailboxes: Effect.sync(() =>
        [...this.mailboxes.values()].map((mailbox) => mailbox.info)
      ),
      move: (path, uidValidity, uids, destination) =>
        changing(
          `move ${path} -> ${destination}`,
          path,
          uidValidity,
          (mailbox) => {
            copyInto(mailbox, uids, destination);
            for (const uid of uids) {
              mailbox.messages.delete(uid);
            }
          },
          destination
        ),
      renameMailbox: (path, destination) =>
        Effect.sync(() => {
          this.calls.push(`rename ${path} -> ${destination}`);
          this.renameMailbox(path, destination);
        }),
      search: (path, uidValidity, search) =>
        Effect.sync(() => {
          reading(path);
        }).pipe(
          Effect.andThen(
            selected(path, uidValidity, (mailbox) => {
              this.calls.push(`search ${path} ${search.kind}`);
              return searchMailbox(mailbox, search);
            })
          )
        ),
      setFlags: (path, uidValidity, uids, operation, flags) =>
        changing(
          `store ${path} ${operation} ${flags.join(" ")}`,
          path,
          uidValidity,
          (mailbox) => {
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
          }
        ),
      setGmailLabels: (path, uidValidity, uids, operation, labels) =>
        changing(
          `label ${path} ${operation} ${labels.join(" ")}`,
          path,
          uidValidity,
          (mailbox) => {
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
          }
        ),
      status: (path) =>
        Effect.suspend(
          (): Effect.Effect<
            MailboxState,
            MailConnectionError | MailboxMissingError
          > => {
            const failure = this.failStatus?.(path);
            if (failure === "dropped") {
              return Effect.fail(
                new MailConnectionError({
                  accountId,
                  message: "The connection to the mail server failed",
                })
              );
            }
            if (failure === "refused") {
              return Effect.fail(new MailboxMissingError({ accountId, path }));
            }
            return withMailbox(path, (mailbox) => {
              this.statuses.push(path);
              this.onStatus?.(path);
              return {
                highestModseq: this.capabilities.has("CONDSTORE")
                  ? mailbox.highestModseq
                  : undefined,
                messages: mailbox.messages.size,
                path,
                uidNext: mailbox.uidNext,
                uidValidity: mailbox.uidValidity,
                unseen:
                  [...mailbox.messages.values()].filter(
                    (message) => !message.flags.includes("\\Seen")
                  ).length + this.miscountedUnseen,
              };
            });
          }
        ),
      watch: (path: string, options: WatchOptions) =>
        Effect.suspend(() => {
          this.calls.push(`watch ${path}`);
          this.watches.push(path);
          const reported = Deferred.makeUnsafe<WatchOutcome>();
          const watcher = {
            end: (outcome: WatchOutcome): void => {
              this.watchers.delete(watcher);
              Deferred.doneUnsafe(reported, Effect.succeed(outcome));
            },
            path,
          };
          this.watchers.add(watcher);
          this.onWatch?.();
          return Deferred.await(reported).pipe(
            Effect.raceFirst(
              Deferred.await(options.stop).pipe(
                Effect.as<WatchOutcome>("quiet")
              )
            ),
            Effect.ensuring(
              Effect.sync(() => {
                this.watchers.delete(watcher);
              })
            )
          );
        }),
    };
  }
}
