import {
  MailAuthError,
  MailConnectionError,
  MailProtocolError,
  MailThrottledError,
  MailboxMissingError,
} from "@repo/mail/errors";
import type { MailTransportError } from "@repo/mail/errors";
import type { AccountId } from "@repo/mail/ids";
import { toMailboxRole } from "@repo/mail/ids";
import type { BodyStructureNode } from "@repo/mail/mime-structure";
import type {
  EnvelopeAddress,
  FetchFields,
  FetchedMessage,
  ImapConnectRequest,
  ImapMailbox,
  ImapSession,
  MailboxSearch,
  MailboxState,
  MessageEnvelope,
  UidSelection,
  WatchOptions,
  WatchOutcome,
} from "@repo/mail/session";
import { ImapConnector } from "@repo/mail/session";
import { Deferred, Effect, Layer, Option, Redacted, Schema } from "effect";
import type { Scope } from "effect";
import { ImapFlow } from "imapflow";
import type {
  FetchMessageObject,
  FetchQueryObject,
  ImapFlowOptions,
  ListResponse,
  MessageAddressObject,
  MessageEnvelopeObject,
  MessageStructureObject,
  SearchObject,
} from "imapflow";

/**
 * Bounds what one server response may cost in main. Attachments are the
 * largest legitimate literals; Gmail caps a message at about 35 MB.
 */
const MAX_LITERAL_BYTES = 64 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 96 * 1024 * 1024;
const CONNECTION_TIMEOUT_MS = 30_000;
/**
 * How long before an access token expires its connection starts looking for
 * a free moment to close. Exchange Online answers the first command after
 * the expiry with `BYE`, failing whatever that command was.
 */
const SESSION_EXPIRY_LEAD_MS = 2 * 60_000;
const SOCKET_TIMEOUT_MS = 2 * 60_000;

const NETWORK_ERROR_CODES: ReadonlySet<string> = new Set([
  "CONNECT_TIMEOUT",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EConnectionClosed",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "ETIMEOUT",
  "GREETING_TIMEOUT",
  "NoConnection",
  "UPGRADE_TIMEOUT",
]);

const THROTTLE_PATTERN =
  /\b(?:THROTTLED|too many simultaneous connections|bandwidth limit|OVERQUOTA|LIMIT)\b/iu;

/**
 * The properties imapflow attaches to its errors. Decoding them, rather than
 * trusting a cast, keeps a malformed rejection from being misclassified.
 */
const ImapFailure = Schema.Struct({
  authenticationFailed: Schema.optional(Schema.Boolean),
  code: Schema.optional(Schema.String),
  mailboxMissing: Schema.optional(Schema.Boolean),
  responseStatus: Schema.optional(Schema.String),
  responseText: Schema.optional(Schema.String),
  serverResponseCode: Schema.optional(Schema.String),
  throttleReset: Schema.optional(Schema.Finite),
  tlsFailed: Schema.optional(Schema.Boolean),
});
const decodeImapFailure = Schema.decodeUnknownOption(ImapFailure);

/**
 * Maps imapflow failures to the engine's typed errors. Messages are fixed
 * text: a server's response can echo addresses or mailbox names, which must
 * not reach logs or the renderer.
 */
export const toTransportError = <Failure>(
  accountId: AccountId,
  error: Failure,
  path?: string
): MailTransportError => {
  const failure = Option.getOrElse(decodeImapFailure(error), () => ({}));
  const {
    authenticationFailed,
    code = "",
    mailboxMissing,
    responseStatus,
    responseText = "",
    serverResponseCode = "",
    throttleReset,
    tlsFailed,
  }: typeof ImapFailure.Type = failure;

  if (authenticationFailed === true) {
    return new MailAuthError({
      accountId,
      message: "The mail server refused the account's sign-in",
    });
  }

  if (
    code === "ETHROTTLE" ||
    THROTTLE_PATTERN.test(serverResponseCode) ||
    THROTTLE_PATTERN.test(responseText)
  ) {
    return new MailThrottledError({
      accountId,
      message: "The mail server asked Kisa to slow down",
      retryAfterMs:
        throttleReset === undefined
          ? undefined
          : Math.max(0, Math.trunc(throttleReset)),
    });
  }

  // imapflow marks a mailbox it could not select, and raises `NotFound` for
  // one whose STATUS was refused and that a LIST no longer shows.
  if ((mailboxMissing === true || code === "NotFound") && path !== undefined) {
    return new MailboxMissingError({ accountId, path });
  }

  if (NETWORK_ERROR_CODES.has(code) || tlsFailed === true) {
    return new MailConnectionError({
      accountId,
      cause: error,
      message: "The connection to the mail server failed",
    });
  }

  return new MailProtocolError({
    accountId,
    cause: error,
    message:
      responseStatus === undefined
        ? "The mail server sent a response Kisa could not read"
        : "The mail server refused a command",
  });
};

/** A compact IMAP sequence set (`1:5,9,12:14`) from any list of UIDs. */
export const toUidSet = (uids: readonly number[]): string => {
  const sorted = [
    ...new Set(uids.filter((uid) => Number.isSafeInteger(uid) && uid > 0)),
  ].toSorted((left, right) => left - right);
  const ranges: string[] = [];
  let [start] = sorted;
  let previous = start;

  for (const uid of sorted.slice(1)) {
    if (previous !== undefined && uid === previous + 1) {
      previous = uid;
      continue;
    }
    if (start !== undefined && previous !== undefined) {
      ranges.push(start === previous ? `${start}` : `${start}:${previous}`);
    }
    start = uid;
    previous = uid;
  }

  if (start !== undefined && previous !== undefined) {
    ranges.push(start === previous ? `${start}` : `${start}:${previous}`);
  }

  return ranges.join(",");
};

const toSelectionRange = (selection: UidSelection): string | undefined => {
  if (selection.kind === "uids") {
    const set = toUidSet(selection.uids);
    return set.length === 0 ? undefined : set;
  }

  const from = Math.max(1, Math.trunc(selection.from));
  if (selection.to === undefined) {
    return `${from}:*`;
  }

  const to = Math.trunc(selection.to);
  return to < from ? undefined : `${from}:${to}`;
};

const toSearchObject = (search: MailboxSearch): SearchObject => {
  // Exhaustive over MailboxSearch; the compiler rejects a missing case.
  // oxlint-disable-next-line eslint/default-case
  switch (search.kind) {
    case "all": {
      return { all: true };
    }
    case "gmailMessage": {
      return { emailId: search.messageId };
    }
    case "gmailRaw": {
      return { gmraw: search.query };
    }
    case "gmailThread": {
      return { threadId: search.threadId };
    }
    case "header": {
      return { header: { [search.name]: search.value } };
    }
    case "text": {
      return { text: search.text };
    }
    case "uidRange": {
      return { uid: `${Math.max(1, search.from)}:${Math.max(1, search.to)}` };
    }
  }
};

const toHeaderQuery = (
  headers: FetchFields["headers"]
): FetchQueryObject["headers"] => {
  if (headers === undefined || headers === true) {
    return headers;
  }
  return [...headers];
};

const toFetchQuery = (fields: FetchFields): FetchQueryObject => ({
  bodyParts:
    fields.sections === undefined || fields.sections.length === 0
      ? undefined
      : [...fields.sections],
  bodyStructure: fields.structure,
  envelope: fields.envelope,
  flags: fields.flags,
  headers: toHeaderQuery(fields.headers),
  internalDate: fields.internalDate,
  labels: fields.gmail,
  size: fields.size,
  threadId: fields.gmail,
  uid: true,
});

const toEpochMs = (value: Date | string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const time = (value instanceof Date ? value : new Date(value)).getTime();
  return Number.isFinite(time) ? time : undefined;
};

const toAddresses = (
  addresses: readonly MessageAddressObject[] | undefined
): readonly EnvelopeAddress[] =>
  (addresses ?? []).map((address) => ({
    address: address.address,
    name: address.name,
  }));

const toEnvelope = (envelope: MessageEnvelopeObject): MessageEnvelope => ({
  bcc: toAddresses(envelope.bcc),
  cc: toAddresses(envelope.cc),
  date: toEpochMs(envelope.date),
  from: toAddresses(envelope.from),
  inReplyTo: envelope.inReplyTo,
  messageId: envelope.messageId,
  replyTo: toAddresses(envelope.replyTo),
  sender: toAddresses(envelope.sender),
  subject: envelope.subject,
  to: toAddresses(envelope.to),
});

const toStructure = (node: MessageStructureObject): BodyStructureNode => ({
  childNodes: node.childNodes?.map(toStructure),
  disposition: node.disposition,
  dispositionParameters: node.dispositionParameters,
  encoding: node.encoding,
  id: node.id,
  parameters: node.parameters,
  part: node.part,
  size: node.size,
  type: node.type,
});

export const toFetchedMessage = (
  message: FetchMessageObject,
  fields: FetchFields
): FetchedMessage => ({
  envelope:
    message.envelope === undefined ? undefined : toEnvelope(message.envelope),
  flags: [...(message.flags ?? [])],
  gmailLabels:
    fields.gmail === true && message.labels !== undefined
      ? [...message.labels]
      : undefined,
  gmailMessageId: fields.gmail === true ? message.emailId : undefined,
  gmailThreadId: fields.gmail === true ? message.threadId : undefined,
  headers: message.headers,
  internalDate: toEpochMs(message.internalDate),
  modseq: message.modseq,
  sections: message.bodyParts,
  size: message.size,
  structure:
    message.bodyStructure === undefined
      ? undefined
      : toStructure(message.bodyStructure),
  uid: message.uid,
});

/**
 * A folder's role, from the server's SPECIAL-USE attributes when it offers
 * them. A server without them (iCloud) is read by imapflow's table of
 * well-known folder names instead; a server with them is authoritative, so a
 * Gmail label that happens to be called "Archive" stays a label.
 */
export const toMailbox = (
  entry: Pick<
    ListResponse,
    "delimiter" | "flags" | "path" | "specialUse" | "specialUseSource"
  >,
  hasSpecialUse: boolean
): ImapMailbox => {
  const flags = [...entry.flags];
  const lowerFlags = new Set(flags.map((flag) => flag.toLowerCase()));
  const trusted =
    !hasSpecialUse || entry.specialUseSource !== "name"
      ? entry.specialUse
      : undefined;

  return {
    delimiter: entry.delimiter,
    flags,
    path: entry.path,
    role: toMailboxRole(entry.path, trusted),
    selectable:
      !lowerFlags.has("\\noselect") && !lowerFlags.has("\\nonexistent"),
  };
};

/** RFC 6154's attributes, each naming a folder's role outright. */
const ROLE_ATTRIBUTES: ReadonlySet<string> = new Set([
  "\\all",
  "\\archive",
  "\\drafts",
  "\\flagged",
  "\\junk",
  "\\sent",
  "\\trash",
]);

type ListedMailbox = Parameters<typeof toMailbox>[0];

/**
 * Every listed folder's role. Without the SPECIAL-USE capability imapflow
 * ignores role attributes and reads names only, yet a server may send the
 * attributes anyway (Exchange is reported to). An attribute names the role
 * outright, so it beats a name, and a role an attribute gave one folder is
 * not given to another by its name.
 */
export const toMailboxes = (
  entries: readonly ListedMailbox[],
  hasSpecialUse: boolean
): readonly ImapMailbox[] => {
  if (hasSpecialUse) {
    return entries.map((entry) => toMailbox(entry, true));
  }
  const attributes = entries.map((entry) =>
    [...entry.flags].find((flag) => ROLE_ATTRIBUTES.has(flag.toLowerCase()))
  );
  const claimed = new Set(
    attributes.flatMap((flag) =>
      flag === undefined ? [] : [flag.toLowerCase()]
    )
  );
  return entries.map((entry, index) => {
    const named =
      entry.specialUse !== undefined &&
      claimed.has(entry.specialUse.toLowerCase())
        ? undefined
        : entry.specialUse;
    return toMailbox(
      { ...entry, specialUse: attributes[index] ?? named },
      false
    );
  });
};

const toClientOptions = (request: ImapConnectRequest): ImapFlowOptions => ({
  auth:
    request.auth.kind === "oauth"
      ? {
          accessToken: Redacted.value(request.auth.accessToken),
          user: request.auth.user,
        }
      : {
          pass: Redacted.value(request.auth.password),
          user: request.auth.user,
        },
  clientInfo: { name: "Kisa" },
  connectionTimeout: CONNECTION_TIMEOUT_MS,
  disableAutoIdle: true,
  doSTARTTLS: request.server.security === "starttls" ? true : undefined,
  emitLogs: false,
  host: request.server.host,
  logger: false,
  maxLiteralSize: MAX_LITERAL_BYTES,
  maxResponseSize: MAX_RESPONSE_BYTES,
  port: request.server.port,
  secure: request.server.security === "tls",
  sessionExpires:
    request.auth.kind === "oauth" ? request.auth.expiresAt : undefined,
  sessionExpiryLead: SESSION_EXPIRY_LEAD_MS,
  socketTimeout: SOCKET_TIMEOUT_MS,
  tls: { minVersion: "TLSv1.2" },
});

/**
 * Removes exactly `range` from the selected mailbox. With UIDPLUS that is
 * `UID EXPUNGE`. Without it a plain `EXPUNGE` removes every `\Deleted`
 * message, including ones another program marked and kept (Thunderbird's
 * "mark as deleted"), so those are unmarked for that moment and marked again
 * after, as MailCraft does.
 */
export const expungeExactly = async (
  client: Pick<
    ImapFlow,
    "messageDelete" | "messageFlagsAdd" | "messageFlagsRemove" | "search"
  >,
  range: string,
  hasUidPlus: boolean
): Promise<boolean> => {
  if (hasUidPlus) {
    return client.messageDelete(range, { uid: true });
  }
  const kept = await client.search(
    { deleted: true, not: { uid: range } },
    { uid: true }
  );
  if (kept === false || kept === undefined) {
    // Without knowing what else would go, nothing is expunged.
    return false;
  }
  const keptRange = toUidSet(kept);
  const flagOptions = { silent: true, uid: true };
  if (keptRange.length > 0) {
    await client.messageFlagsRemove(keptRange, ["\\Deleted"], flagOptions);
  }
  try {
    return await client.messageDelete(range, { uid: true });
  } finally {
    if (keptRange.length > 0) {
      await client.messageFlagsAdd(keptRange, ["\\Deleted"], flagOptions);
    }
  }
};

/** What imapflow emits for the selected mailbox while a connection idles. */
const MAILBOX_EVENTS = ["exists", "expunge", "flags"] as const;
type MailboxEvent = (typeof MAILBOX_EVENTS)[number];

/** What comes with a mailbox event; only `exists` carries the counts. */
interface MailboxEventData {
  readonly count?: number | undefined;
  readonly path: string;
  readonly prevCount?: number | undefined;
}

/** The part of an imapflow client a wait in IDLE uses. */
export interface IdleClient {
  readonly getMailboxLock: (
    path: string,
    options: { readonly readOnly: boolean }
  ) => Promise<{ readonly release: () => void }>;
  /** Resolves when the IDLE ends; `false` when the server would not run it. */
  readonly idle: () => Promise<boolean | undefined>;
  readonly noop: () => Promise<void>;
  readonly off: (
    event: MailboxEvent,
    listener: (data: MailboxEventData) => void
  ) => unknown;
  readonly on: (
    event: MailboxEvent,
    listener: (data: MailboxEventData) => void
  ) => unknown;
  readonly usable: boolean;
}

/**
 * How long a server gets to end an IDLE Kisa asked it to end. A healthy one
 * answers in a round trip. One that does not is usually a connection that
 * died while the computer slept: it is dropped, so the cycle that asked does
 * not wait behind it for the socket timeout.
 */
export const IDLE_END_TIMEOUT_MS = 5000;

/**
 * imapflow ends a quiet IDLE itself, with a `NOOP` after the socket timeout:
 * that is the keepalive, and how a dead connection is found. The IDLE is then
 * started again, at most as often as that timeout fits into the wait, so an
 * IDLE that keeps ending at once cannot spin: the wait's own clock ends it.
 */
const idleRunsFor = (maxMs: number): number =>
  Math.ceil(maxMs / SOCKET_TIMEOUT_MS) + 2;

const connectionLost = (accountId: AccountId): MailConnectionError =>
  new MailConnectionError({
    accountId,
    message: "The connection to the mail server failed",
  });

/**
 * A message count that rose is mail arriving. Every other report (the count
 * falling, an expunge, a flag set or cleared) is a change to mail already
 * there.
 */
const toReport = (event: MailboxEvent, data: MailboxEventData): WatchOutcome =>
  event === "exists" &&
  data.count !== undefined &&
  data.prevCount !== undefined &&
  data.count > data.prevCount
    ? "arrived"
    : "changed";

/**
 * Waits in `path` for the server to report anything (IDLE).
 *
 * Completing `options.stop` ends the wait and leaves the connection usable:
 * the IDLE is ended, with a `NOOP`, since any command ends one and that one
 * changes nothing. Interrupting the wait only releases the mailbox and the
 * listeners, for a caller about to close the connection, who must not wait
 * on a server that may be gone.
 */
export const watchMailbox = Effect.fn("ImapSession.watchMailbox")(
  function* watchMailbox(
    accountId: AccountId,
    client: IdleClient,
    path: string,
    options: WatchOptions
  ): Effect.fn.Return<WatchOutcome, MailTransportError, Scope.Scope> {
    if (yield* Deferred.isDone(options.stop)) {
      return "quiet";
    }

    const attempt = <A>(operation: () => Promise<A>) =>
      Effect.tryPromise({
        catch: (error) => toTransportError(accountId, error, path),
        try: operation,
      });

    yield* Effect.acquireRelease(
      attempt(() => client.getMailboxLock(path, { readOnly: true })),
      (lock) =>
        Effect.sync(() => {
          lock.release();
        })
    );

    const reported = yield* Deferred.make<WatchOutcome>();
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const listeners = MAILBOX_EVENTS.map((event) => ({
          event,
          listener: (data: MailboxEventData): void => {
            if (data.path === path) {
              Deferred.doneUnsafe(
                reported,
                Effect.succeed(toReport(event, data))
              );
            }
          },
        }));
        for (const { event, listener } of listeners) {
          client.on(event, listener);
        }
        return listeners;
      }),
      (listeners) =>
        Effect.sync(() => {
          for (const { event, listener } of listeners) {
            client.off(event, listener);
          }
        })
    );

    // A lost connection fails the wait. An IDLE that merely stopped does not:
    // the listeners and the clock are still in place.
    const idling = Effect.gen(function* idleUntilGivenUp() {
      for (let run = 0; run < idleRunsFor(options.maxMs); run += 1) {
        const ran = yield* attempt(() => client.idle());
        if (!client.usable) {
          return yield* connectionLost(accountId);
        }
        if (ran === false) {
          // The server would not run IDLE.
          break;
        }
      }
      return yield* Effect.never;
    });

    const outcome = yield* Deferred.await(reported).pipe(
      Effect.raceFirst(idling),
      Effect.raceFirst(
        Deferred.await(options.stop).pipe(Effect.as<WatchOutcome>("quiet"))
      ),
      Effect.timeoutOrElse({
        duration: options.maxMs,
        orElse: () => Effect.succeed<WatchOutcome>("quiet"),
      })
    );

    yield* attempt(() => client.noop()).pipe(
      Effect.timeoutOrElse({
        duration: IDLE_END_TIMEOUT_MS,
        orElse: () => Effect.fail(connectionLost(accountId)),
      })
    );
    return outcome;
  },
  Effect.scoped
);

/** A command the server answered with NO, in the shape errors are read from. */
const refuseCommand = (): never => {
  throw Object.assign(new Error("command refused"), { responseStatus: "NO" });
};

/**
 * A mailbox that carries another UIDVALIDITY than the caller's, or that the
 * server will not open, in the shape errors are read from: the mailbox the
 * caller means is not there.
 */
const refuseMailbox = (): never => {
  throw Object.assign(new Error("mailbox refused"), { mailboxMissing: true });
};

/** A connection lost under a command, in the shape errors are read from. */
const loseConnection = (): never => {
  throw Object.assign(new Error("connection lost"), { code: "NoConnection" });
};

export const makeSession = (
  accountId: AccountId,
  client: ImapFlow
): ImapSession => {
  const run = <A>(
    path: string | undefined,
    operation: () => Promise<A>
  ): Effect.Effect<A, MailTransportError> =>
    Effect.tryPromise({
      catch: (error) => toTransportError(accountId, error, path),
      try: operation,
    });

  const selectedValidity = (): bigint | undefined =>
    client.mailbox === false ? undefined : client.mailbox.uidValidity;

  /**
   * Every message command runs inside imapflow's mailbox lock, which queues
   * callers and reselects only when the path or mode differs.
   *
   * With a `uidValidity`, the command runs only in a mailbox selected under
   * it, and is otherwise refused before anything is sent: see `ImapSession`.
   * The server gives a mailbox's UIDVALIDITY when it is selected, so this
   * costs no command. imapflow keeps a mailbox selected between commands,
   * so a selection can be older than a rebuild the caller already saw in a
   * `STATUS`: one that differs is made once more before the refusal.
   */
  const withMailbox = <A>(
    path: string,
    uidValidity: bigint | undefined,
    operation: () => Promise<A>,
    mode: "read" | "write" = "read"
  ): Effect.Effect<A, MailTransportError> =>
    run(path, async () => {
      const readOnly = mode === "read";
      const lock = await client.getMailboxLock(path, { readOnly });
      try {
        if (uidValidity !== undefined && selectedValidity() !== uidValidity) {
          await client.mailboxOpen(path, { readOnly });
          if (selectedValidity() !== uidValidity) {
            refuseMailbox();
          }
        }
        return await operation();
      } finally {
        lock.release();
      }
    });

  const capabilities = new Set(
    [...client.capabilities.keys()].map((capability) =>
      capability.toUpperCase()
    )
  );

  const onMessages = (
    path: string,
    uidValidity: bigint,
    uids: readonly number[],
    operation: (range: string) => Promise<unknown>
  ): Effect.Effect<void, MailTransportError> => {
    const range = toUidSet(uids);
    return range.length === 0
      ? Effect.void
      : withMailbox(
          path,
          uidValidity,
          async () => {
            if ((await operation(range)) === false) {
              refuseCommand();
            }
          },
          "write"
        );
  };

  return {
    append: (path, message, flags) =>
      run(path, async () => {
        const appended = await client.append(path, Buffer.from(message), [
          ...flags,
        ]);
        if (appended === false) {
          refuseCommand();
        }
      }),
    capabilities,
    copy: (path, uidValidity, uids, destination) =>
      onMessages(path, uidValidity, uids, (range) =>
        client.messageCopy(range, destination, { uid: true })
      ),
    createMailbox: (path) =>
      run(path, async () => {
        await client.mailboxCreate(path);
      }),
    deleteMailbox: (path) =>
      run(path, async () => {
        await client.mailboxDelete(path);
      }),
    expunge: (path, uidValidity, uids) =>
      onMessages(path, uidValidity, uids, (range) =>
        expungeExactly(client, range, capabilities.has("UIDPLUS"))
      ),
    fetch: (path, uidValidity, selection, fields, options) => {
      const range = toSelectionRange(selection);

      if (range === undefined) {
        return Effect.succeed([]);
      }

      return withMailbox(path, uidValidity, async () => {
        const messages: FetchedMessage[] = [];
        for await (const message of client.fetch(range, toFetchQuery(fields), {
          changedSince: options?.changedSince,
          uid: true,
        })) {
          messages.push(toFetchedMessage(message, fields));
        }
        return messages;
      });
    },
    fetchSection: (path, uidValidity, uid, section, maxBytes) =>
      withMailbox(path, uidValidity, async () => {
        const message = await client.fetchOne(
          String(uid),
          { bodyParts: [{ key: section, maxLength: maxBytes }], uid: true },
          { uid: true }
        );
        return message === false ? undefined : message.bodyParts?.get(section);
      }),
    hasMessage: (path, search) =>
      withMailbox(path, undefined, async () => {
        const uids = await client.search(toSearchObject(search), { uid: true });

        if (uids === false || uids === undefined) {
          return refuseCommand();
        }

        return uids.length > 0;
      }),
    listMailboxes: run(undefined, async () => {
      // A full listing: `listOnly` returns before imapflow assigns roles.
      const entries = await client.list();
      return toMailboxes(entries, capabilities.has("SPECIAL-USE"));
    }),
    move: (path, uidValidity, uids, destination) =>
      onMessages(path, uidValidity, uids, async (range) => {
        if (capabilities.has("MOVE")) {
          return client.messageMove(range, destination, { uid: true });
        }
        // COPY, then remove exactly the originals; the source is left alone
        // when the copy was refused, so nothing is lost.
        const copied = await client.messageCopy(range, destination, {
          uid: true,
        });
        return copied === false
          ? false
          : expungeExactly(client, range, capabilities.has("UIDPLUS"));
      }),
    renameMailbox: (path, destination) =>
      run(path, async () => {
        await client.mailboxRename(path, destination);
      }),
    search: (path, uidValidity, search) =>
      withMailbox(path, uidValidity, async () => {
        const uids = await client.search(toSearchObject(search), { uid: true });

        if (uids === false || uids === undefined) {
          return refuseCommand();
        }

        return uids.toSorted((left, right) => left - right);
      }),
    setFlags: (path, uidValidity, uids, operation, flags) => {
      const range = toUidSet(uids);

      if (range.length === 0) {
        return Effect.void;
      }

      return withMailbox(
        path,
        uidValidity,
        async () => {
          const options = { silent: true, uid: true };
          const changed =
            operation === "add"
              ? await client.messageFlagsAdd(range, [...flags], options)
              : await client.messageFlagsRemove(range, [...flags], options);

          if (!changed) {
            throw Object.assign(new Error("store refused"), {
              responseStatus: "NO",
            });
          }
        },
        "write"
      );
    },
    setGmailLabels: (path, uidValidity, uids, operation, labels) =>
      onMessages(path, uidValidity, uids, (range) => {
        const options = { silent: true, uid: true, useLabels: true };
        return operation === "add"
          ? client.messageFlagsAdd(range, [...labels], options)
          : client.messageFlagsRemove(range, [...labels], options);
      }),
    status: (path) =>
      run(path, async (): Promise<MailboxState> => {
        const status = await client.status(path, {
          highestModseq: true,
          messages: true,
          uidNext: true,
          uidValidity: true,
          unseen: true,
        });

        if (status === false || status.uidValidity === undefined) {
          // imapflow answers `false` for a STATUS the server refused and for
          // one whose connection was lost before the answer came. Only the
          // first says anything about the mailbox: a pass goes on without a
          // mailbox that will not open, and must not go on without a
          // connection.
          return client.usable ? refuseMailbox() : loseConnection();
        }

        return {
          highestModseq: status.highestModseq,
          messages: status.messages ?? 0,
          path,
          uidNext: status.uidNext ?? 1,
          uidValidity: status.uidValidity,
          unseen: status.unseen,
        };
      }),
    watch: (path, options) => watchMailbox(accountId, client, path, options),
  };
};

const openClient = (request: ImapConnectRequest) =>
  Effect.tryPromise({
    catch: (error) => toTransportError(request.accountId, error),
    try: async () => {
      const client = new ImapFlow(toClientOptions(request));
      // An 'error' event without a listener would throw in main. Failures
      // surface through the rejected command instead.
      client.on("error", () => {
        // Deliberately ignored; see above.
      });
      await client.connect();
      return client;
    },
  });

/**
 * How long a server gets to answer `LOGOUT`. Quit and disconnect close every
 * connection, and a server that does not answer, or a network that has gone,
 * must not hold them for the socket timeout. The socket closes either way.
 */
export const LOGOUT_TIMEOUT_MS = 1000;

export const closeClient = (
  client: Pick<ImapFlow, "close" | "logout" | "usable">
): Effect.Effect<void> =>
  Effect.suspend(() =>
    client.usable
      ? Effect.tryPromise(() => client.logout()).pipe(
          Effect.timeout(LOGOUT_TIMEOUT_MS),
          Effect.ignore
        )
      : Effect.void
  ).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        client.close();
      })
    )
  );

export const ImapFlowConnectorLive = Layer.succeed(
  ImapConnector,
  ImapConnector.of({
    connect: (request) =>
      Effect.acquireRelease(openClient(request), closeClient).pipe(
        Effect.map((client) => makeSession(request.accountId, client))
      ),
  })
);
