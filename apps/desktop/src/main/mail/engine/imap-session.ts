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
} from "@repo/mail/session";
import { ImapConnector } from "@repo/mail/session";
import { Effect, Layer, Option, Redacted, Schema } from "effect";
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

  if (mailboxMissing === true && path !== undefined) {
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

/** A command the server answered with NO, in the shape errors are read from. */
const refuseCommand = (): never => {
  throw Object.assign(new Error("command refused"), { responseStatus: "NO" });
};

const makeSession = (accountId: AccountId, client: ImapFlow): ImapSession => {
  const run = <A>(
    path: string | undefined,
    operation: () => Promise<A>
  ): Effect.Effect<A, MailTransportError> =>
    Effect.tryPromise({
      catch: (error) => toTransportError(accountId, error, path),
      try: operation,
    });

  /**
   * Every message command runs inside imapflow's mailbox lock, which queues
   * callers and reselects only when the path or mode differs.
   */
  const withMailbox = <A>(
    path: string,
    operation: () => Promise<A>,
    mode: "read" | "write" = "read"
  ): Effect.Effect<A, MailTransportError> =>
    run(path, async () => {
      const lock = await client.getMailboxLock(path, {
        readOnly: mode === "read",
      });
      try {
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
    uids: readonly number[],
    operation: (range: string) => Promise<unknown>
  ): Effect.Effect<void, MailTransportError> => {
    const range = toUidSet(uids);
    return range.length === 0
      ? Effect.void
      : withMailbox(
          path,
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
    copy: (path, uids, destination) =>
      onMessages(path, uids, (range) =>
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
    expunge: (path, uids) =>
      onMessages(path, uids, (range) =>
        expungeExactly(client, range, capabilities.has("UIDPLUS"))
      ),
    fetch: (path, selection, fields, options) => {
      const range = toSelectionRange(selection);

      if (range === undefined) {
        return Effect.succeed([]);
      }

      return withMailbox(path, async () => {
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
    fetchSection: (path, uid, section, maxBytes) =>
      withMailbox(path, async () => {
        const message = await client.fetchOne(
          String(uid),
          { bodyParts: [{ key: section, maxLength: maxBytes }], uid: true },
          { uid: true }
        );
        return message === false ? undefined : message.bodyParts?.get(section);
      }),
    listMailboxes: run(undefined, async () => {
      // A full listing: `listOnly` returns before imapflow assigns roles.
      const entries = await client.list();
      return toMailboxes(entries, capabilities.has("SPECIAL-USE"));
    }),
    move: (path, uids, destination) =>
      onMessages(path, uids, async (range) => {
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
    search: (path, search) =>
      withMailbox(path, async () => {
        const uids = await client.search(toSearchObject(search), { uid: true });

        if (uids === false || uids === undefined) {
          throw Object.assign(new Error("search refused"), {
            responseStatus: "NO",
          });
        }

        return uids.toSorted((left, right) => left - right);
      }),
    setFlags: (path, uids, operation, flags) => {
      const range = toUidSet(uids);

      if (range.length === 0) {
        return Effect.void;
      }

      return withMailbox(
        path,
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
    setGmailLabels: (path, uids, operation, labels) =>
      onMessages(path, uids, (range) => {
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
        });

        if (status === false || status.uidValidity === undefined) {
          throw Object.assign(new Error("status refused"), {
            mailboxMissing: true,
          });
        }

        return {
          highestModseq: status.highestModseq,
          messages: status.messages ?? 0,
          path,
          uidNext: status.uidNext ?? 1,
          uidValidity: status.uidValidity,
        };
      }),
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
