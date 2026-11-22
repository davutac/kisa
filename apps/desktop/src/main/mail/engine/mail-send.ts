import { mailMessages } from "@repo/database/schemas";
import { fetchAttachment } from "@repo/mail/attachments";
import { MailProtocolError } from "@repo/mail/errors";
import { parseMessageIds } from "@repo/mail/headers";
import { MessageId, ThreadId } from "@repo/mail/ids";
import { refreshMailboxes } from "@repo/mail/mutations";
import { SmtpTransport } from "@repo/mail/smtp";
import { MailEngineStore } from "@repo/mail/store";
import type { MailAccount } from "@repo/mail/store";
import { loadThreadBodies } from "@repo/mail/sync";
import { and, eq } from "drizzle-orm";
import { Context, Effect } from "effect";

import type { MailThreadMessageAction } from "../../../shared/ipc/mail";
import { MAX_OUTGOING_ATTACHMENT_BYTES } from "../../../shared/ipc/mail";
import { parseMailbox } from "../mail-address";
import { resolveImapAuth } from "./account-credentials";
import { MailDatabase } from "./mail-database";
import {
  MailEngineError,
  forkAccountWork,
  publishChanges,
  requestMailSync,
  requireAccount,
  withCacheLock,
  withForeground,
} from "./mail-engine";
import { readConversation } from "./mail-reads";
import {
  composeMessage,
  forwardBody,
  forwardSubject,
  isSendableAddress,
  newMessageId,
  replyBody,
  replySubject,
} from "./outgoing-message";
import type {
  ComposedMessage,
  OutgoingAddress,
  OutgoingAttachment,
  OutgoingBody,
} from "./outgoing-message";

export interface OutgoingRecipients {
  readonly bcc: readonly string[];
  readonly cc: readonly string[];
  readonly to: readonly string[];
}

const parseRecipients = Effect.fn("MailSend.parseRecipients")(
  function* parseRecipients(account: MailAccount, values: readonly string[]) {
    const recipients: OutgoingAddress[] = [];
    for (const value of values) {
      const mailbox = parseMailbox(value);
      if (mailbox === undefined || !isSendableAddress(mailbox.address)) {
        return yield* new MailProtocolError({
          accountId: account.accountId,
          message: `Invalid recipient address: ${value}`,
        });
      }
      recipients.push({ address: mailbox.address, name: mailbox.name });
    }
    return recipients;
  }
);

const resolveRecipients = Effect.fn("MailSend.resolveRecipients")(
  function* resolveRecipients(
    account: MailAccount,
    recipients: OutgoingRecipients
  ) {
    const to = yield* parseRecipients(account, recipients.to);
    const cc = yield* parseRecipients(account, recipients.cc);
    const bcc = yield* parseRecipients(account, recipients.bcc);

    if (to.length + cc.length + bcc.length === 0) {
      return yield* new MailProtocolError({
        accountId: account.accountId,
        message: "Add at least one recipient before sending",
      });
    }
    return { bcc, cc, to };
  }
);

/** The account's address, with the name it signs mail with. */
const senderOf = Effect.fn("MailSend.senderOf")(function* senderOf(
  account: MailAccount
) {
  const database = yield* MailDatabase;
  const row = yield* database.use("Could not load the account", (db) =>
    db.query.mailAccounts.findFirst({
      columns: { displayName: true },
      where: { accountId: account.accountId },
    })
  );
  return {
    address: account.email,
    name: row?.displayName ?? undefined,
  } satisfies OutgoingAddress;
});

/**
 * Who keeps the copy of a sent message in Sent, by provider. The one place
 * to change after trying a provider for real.
 *
 * - `server`: the provider files what its SMTP server accepted (Gmail).
 * - `kisa`: Kisa appends a copy at once unless one is already there.
 * - `serverLater`: Outlook files the copy itself a moment after accepting the
 *   message, under a Message-ID of its own, so Kisa cannot find it by the one
 *   it sent and must not add one: tried on Outlook.com, that left two. Sent
 *   is refreshed at each of `SentCopyRefreshes`, so the copy shows without
 *   waiting for the next sync.
 */
const SENT_COPY_FILER = {
  gmail: "server",
  icloud: "kisa",
  imap: "kisa",
  outlook: "serverLater",
} as const satisfies Record<
  MailAccount["provider"],
  "kisa" | "server" | "serverLater"
>;

/**
 * When to refresh Sent for a `serverLater` provider, in milliseconds after
 * the send. MailCraft rereads Exchange's Sent Items after 3 and 15 seconds.
 */
export const SentCopyRefreshes = Context.Reference<readonly number[]>(
  "kisa/main/mail/engine/SentCopyRefreshes",
  {
    defaultValue: () => [3000, 15_000],
  }
);

const SENT_COPY_NOT_FILED = "Message sent, but its Sent copy was not filed";

const sentMailboxOf = Effect.fn("MailSend.sentMailboxOf")(
  function* sentMailboxOf(account: MailAccount) {
    const store = yield* MailEngineStore;
    return (yield* store.getMailboxes(account.accountId)).find(
      (mailbox) => mailbox.role === "sent" && mailbox.selectable
    );
  }
);

/** Caches Sent and tells the windows what changed. */
const refreshSent = (account: MailAccount, sentPath: string) =>
  withForeground(account, (scope) =>
    withCacheLock(
      account.accountId,
      Effect.gen(function* refreshSentMailbox() {
        const changes = yield* refreshMailboxes(scope, [sentPath]);
        yield* publishChanges(account.accountId, changes);
      })
    )
  );

/**
 * Appends a copy of the message to Sent unless one with its Message-ID is
 * already there, so a retry never leaves two, then caches Sent. One turn of
 * the cache lock covers the look and the append.
 */
const appendSentCopy = (
  account: MailAccount,
  composed: ComposedMessage,
  sentPath: string
) =>
  withForeground(account, (scope) =>
    withCacheLock(
      account.accountId,
      Effect.gen(function* appendToSent() {
        const existing = yield* scope.session.search(sentPath, {
          kind: "header",
          name: "Message-ID",
          value: `<${composed.messageId}>`,
        });
        if (existing.length === 0) {
          yield* scope.session.append(sentPath, composed.sentCopy, ["\\Seen"]);
        }
        const changes = yield* refreshMailboxes(scope, [sentPath]);
        yield* publishChanges(account.accountId, changes);
      })
    )
  );

/** Refreshes Sent at each of `SentCopyRefreshes`, unlocked in between. */
const showServerSentCopy = Effect.fn("MailSend.showServerSentCopy")(
  function* showServerSentCopy(account: MailAccount, sentPath: string) {
    const refreshes = yield* SentCopyRefreshes;
    let waited = 0;
    for (const at of refreshes) {
      yield* Effect.sleep(Math.max(0, at - waited));
      waited = at;
      yield* refreshSent(account, sentPath).pipe(Effect.ignore);
    }
  }
);

/**
 * Makes sure Sent keeps a copy of a sent message, as `SENT_COPY_FILER`
 * decides. A late server's copy is waited for apart from the send, so the
 * user's reply does not wait for it.
 */
const fileSentCopy = Effect.fn("MailSend.fileSentCopy")(function* fileSentCopy(
  account: MailAccount,
  composed: ComposedMessage
) {
  const filer = SENT_COPY_FILER[account.provider];
  if (filer === "server") {
    return;
  }
  const sent = yield* sentMailboxOf(account);
  if (sent === undefined) {
    return yield* Effect.logWarning(
      "Message sent, but the account has no Sent folder to keep a copy in"
    );
  }
  if (filer === "kisa") {
    yield* appendSentCopy(account, composed, sent.path);
    return;
  }
  yield* forkAccountWork(
    account.accountId,
    showServerSentCopy(account, sent.path)
  );
});

/**
 * Sends over SMTP, then files the Sent copy. Once the server has the
 * message, nothing afterwards can make the send fail: a missing Sent copy
 * costs less than the user sending twice.
 */
const deliver = Effect.fn("MailSend.deliver")(function* deliver(
  account: MailAccount,
  composed: ComposedMessage
) {
  const smtp = yield* SmtpTransport;
  const auth = yield* resolveImapAuth(account);
  const result = yield* smtp.send({
    accountId: account.accountId,
    auth,
    envelope: composed.envelope,
    message: composed.transmitted,
    server: account.smtp,
  });

  yield* fileSentCopy(account, composed).pipe(
    Effect.catchCause(() => Effect.logWarning(SENT_COPY_NOT_FILED))
  );
  yield* Effect.sync(() => requestMailSync(account.accountId));
  return result;
});

const toMessageId = (account: MailAccount, rfc822MessageId?: string) =>
  (rfc822MessageId === undefined
    ? undefined
    : parseMessageIds(rfc822MessageId)[0]) ?? newMessageId(account.email);

export interface NewMessageRequest extends OutgoingRecipients {
  readonly accountId: string;
  readonly attachments: readonly OutgoingAttachment[];
  readonly body: OutgoingBody;
  /** A scheduled send keeps one id across attempts, so it can be looked for. */
  readonly rfc822MessageId?: string | undefined;
  readonly subject: string;
}

export const sendNewMessage = Effect.fn("MailSend.sendNewMessage")(
  function* sendNewMessage(request: NewMessageRequest) {
    const account = yield* requireAccount(request.accountId);
    const recipients = yield* resolveRecipients(account, request);
    const from = yield* senderOf(account);

    return yield* deliver(
      account,
      composeMessage({
        ...recipients,
        attachments: request.attachments,
        body: request.body,
        date: new Date(),
        from,
        messageId: toMessageId(account, request.rfc822MessageId),
        subject: request.subject,
      })
    );
  }
);

export interface ThreadMessageRequest extends OutgoingRecipients {
  readonly accountId: string;
  readonly action: MailThreadMessageAction;
  readonly attachments: readonly OutgoingAttachment[];
  readonly body: OutgoingBody;
  readonly messageId: string;
  readonly threadId: string;
}

/** The cached conversation, with the bodies a reply quotes downloaded. */
const conversationFor = Effect.fn("MailSend.conversationFor")(
  function* conversationFor(account: MailAccount, threadId: string) {
    const database = yield* MailDatabase;
    const read = () =>
      database.use("Could not load the conversation", (db) =>
        readConversation(db, account.accountId, threadId)
      );
    const conversation = yield* read();

    if (conversation === undefined) {
      return yield* new MailEngineError({
        message: "This conversation is no longer available",
      });
    }
    if (!conversation.missingBodies) {
      return conversation;
    }
    yield* withForeground(account, (scope) =>
      loadThreadBodies(scope, ThreadId.make(threadId))
    ).pipe(Effect.ignore);
    return (yield* read()) ?? conversation;
  }
);

/** The parent's ids that thread a reply under it. */
const threadingOf = Effect.fn("MailSend.threadingOf")(function* threadingOf(
  account: MailAccount,
  messageId: string
) {
  const database = yield* MailDatabase;
  const [row] = yield* database.use("Could not load the conversation", (db) =>
    db
      .select({
        firstReference: mailMessages.firstReference,
        inReplyTo: mailMessages.inReplyTo,
        rfc822MessageId: mailMessages.rfc822MessageId,
      })
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.accountId, account.accountId),
          eq(mailMessages.messageId, messageId)
        )
      )
      .limit(1)
      .all()
  );
  const parent = row?.rfc822MessageId ?? undefined;
  return {
    inReplyTo: parent,
    references: [
      ...new Set(
        [row?.firstReference, row?.inReplyTo, parent].flatMap((id) =>
          id === null || id === undefined ? [] : [id]
        )
      ),
    ],
  };
});

/** A forward carries the original's attachments, fetched from the server. */
const forwardedAttachments = Effect.fn("MailSend.forwardedAttachments")(
  function* forwardedAttachments(
    account: MailAccount,
    messageId: string,
    listed: readonly {
      readonly contentId?: string | undefined;
      readonly disposition?: string | undefined;
      readonly filename: string;
      readonly section: string;
    }[]
  ) {
    const wanted = listed.filter(
      (attachment) =>
        attachment.filename.length > 0 ||
        attachment.disposition === "attachment" ||
        attachment.contentId !== undefined
    );
    if (wanted.length === 0) {
      return [];
    }

    const fetched = yield* withForeground(account, (scope) =>
      Effect.forEach(
        wanted,
        (attachment) =>
          fetchAttachment(
            scope,
            MessageId.make(messageId),
            attachment.section
          ).pipe(
            Effect.map((loaded) =>
              loaded === undefined
                ? []
                : [
                    {
                      bytes: loaded.bytes,
                      contentId: attachment.contentId,
                      filename: loaded.filename,
                      mediaType: loaded.mediaType,
                    } satisfies OutgoingAttachment,
                  ]
            )
          ),
        { concurrency: 3 }
      )
    );
    return fetched.flat();
  }
);

export const sendThreadMessage = Effect.fn("MailSend.sendThreadMessage")(
  function* sendThreadMessage(request: ThreadMessageRequest) {
    const account = yield* requireAccount(request.accountId);
    const recipients = yield* resolveRecipients(account, request);
    const from = yield* senderOf(account);
    const conversation = yield* conversationFor(account, request.threadId);
    const target =
      conversation.messages.find(
        (candidate) => candidate.message.id === request.messageId
      ) ?? conversation.messages.at(-1);

    if (target === undefined) {
      return yield* new MailEngineError({
        message: "This conversation is no longer available",
      });
    }

    const quoted = {
      body: target.message.body,
      cc: target.message.cc,
      from: target.message.from,
      sentAt: target.message.sentAt,
      subject: target.message.subject,
      to: target.message.to,
    };
    const threading = yield* threadingOf(account, target.message.id);
    const isForward = request.action === "forward";
    const attachments = isForward
      ? [
          ...(yield* forwardedAttachments(
            account,
            target.message.id,
            target.attachments
          )),
          ...request.attachments,
        ]
      : request.attachments;
    const totalBytes = attachments.reduce(
      (total, attachment) => total + attachment.bytes.byteLength,
      0
    );

    if (totalBytes > MAX_OUTGOING_ATTACHMENT_BYTES) {
      return yield* new MailProtocolError({
        accountId: account.accountId,
        message: "The attachments are too large to send",
      });
    }

    return yield* deliver(
      account,
      composeMessage({
        ...recipients,
        ...threading,
        attachments,
        body: isForward
          ? forwardBody(request.body, quoted)
          : replyBody(request.body, quoted),
        date: new Date(),
        from,
        messageId: newMessageId(account.email),
        subject: isForward
          ? forwardSubject(target.message.subject)
          : replySubject(target.message.subject),
      })
    );
  }
);

/**
 * Whether a message with this Message-ID reached the account's sent mail,
 * for a scheduled send whose outcome was unknown.
 */
export const findSentMessage = Effect.fn("MailSend.findSentMessage")(
  function* findSentMessage(accountId: string, rfc822MessageId: string) {
    const account = yield* requireAccount(accountId);
    const [id] = parseMessageIds(rfc822MessageId);
    const store = yield* MailEngineStore;
    const mailboxes = yield* store.getMailboxes(account.accountId);
    const isGmail = account.provider === "gmail";
    const mailbox = mailboxes.find(
      (candidate) =>
        candidate.selectable && candidate.role === (isGmail ? "all" : "sent")
    );

    if (id === undefined || mailbox === undefined) {
      return false;
    }

    const found = yield* withForeground(account, (scope) =>
      scope.session.search(
        mailbox.path,
        isGmail
          ? { kind: "gmailRaw", query: `rfc822msgid:${id}` }
          : { kind: "header", name: "Message-ID", value: `<${id}>` }
      )
    );
    return found.length > 0;
  }
);
