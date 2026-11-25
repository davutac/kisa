// oxlint-disable typescript/no-unsafe-type-assertion
// Shared setup for engine tests: an in-memory migrated database, the real
// SQLite store, and helpers to seed accounts and read back rows.
import { fileURLToPath } from "node:url";

import {
  applyDatabaseMigrations,
  createDatabaseClient,
  openDatabaseConnection,
} from "@repo/database/client";
import type { DatabaseRemoteCallback } from "@repo/database/remote-client";
import { createRemoteDatabaseClient } from "@repo/database/remote-client";
import type { Dialect } from "@repo/mail/dialects";
import { MailStoreError } from "@repo/mail/errors";
import { AccountId } from "@repo/mail/ids";
import type { MailEngineStore } from "@repo/mail/store";
import { skeletonStep, syncAccount } from "@repo/mail/sync";
import type { SyncScope } from "@repo/mail/sync";
import { Effect, Layer } from "effect";

import { MailDatabase } from "../../src/main/mail/engine/mail-database";
import { MailEngineStoreLive } from "../../src/main/mail/engine/mail-store";
import { envelope } from "./fake-imap-server";
import type { FakeImapServer, FakeMessageInput } from "./fake-imap-server";

export const connection = openDatabaseConnection(":memory:");
applyDatabaseMigrations(
  createDatabaseClient(connection),
  fileURLToPath(
    new URL("../../../../packages/database/drizzle", import.meta.url)
  )
);

const executeRemoteQuery: DatabaseRemoteCallback = (
  query,
  parameters,
  method
) => {
  const statement = connection.prepare(query);

  if (method === "run") {
    statement.run(...parameters);
    return Promise.resolve({ rows: [] });
  }

  const dataStatement = statement.raw(true);
  if (method === "get") {
    return Promise.resolve({
      rows: dataStatement.get(...parameters) as never[],
    });
  }

  return Promise.resolve({ rows: dataStatement.all(...parameters) });
};

export const remoteDatabase = createRemoteDatabaseClient(executeRemoteQuery);

/** The engine's database service over the in-memory database. */
export const TestDatabase = Layer.succeed(
  MailDatabase,
  MailDatabase.of({
    use: (message, run) =>
      Effect.tryPromise({
        catch: (cause) => new MailStoreError({ cause, message }),
        try: () => run(remoteDatabase),
      }),
  })
);

export const TestStore = MailEngineStoreLive.pipe(Layer.provide(TestDatabase));

export const run = <A, E>(
  effect: Effect.Effect<A, E, MailEngineStore>
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(TestStore)));

export const accountId = AccountId.make("test@example.com");

export const insertAccount = (
  dialect: "generic" | "gmail",
  provider: "gmail" | "icloud" | "imap" | "outlook" = dialect === "gmail"
    ? "gmail"
    : "icloud"
): void => {
  connection
    .prepare(
      `INSERT INTO mail_accounts (account_id, created_at, credentials, dialect,
        email, imap_host, imap_port, imap_security, provider, smtp_host,
        smtp_port, smtp_security, sort_order, updated_at, username)
       VALUES (?, 0, X'00', ?, ?, 'imap.example.com', 993, 'tls', ?,
        'smtp.example.com', 465, 'tls', 0, 0, ?)`
    )
    .run(accountId, dialect, accountId, provider, accountId);
};

export const scopeFor = (
  server: FakeImapServer,
  dialect: Dialect
): SyncScope => ({
  accountId,
  dialect,
  session: server.session(),
});

/** One complete pass plus every skeleton step, as a first connect does. */
export const syncFully = async (scope: SyncScope): Promise<void> => {
  await run(syncAccount(scope));
  for (let step = 0; step < 100; step += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    if ((await run(skeletonStep(scope))) === undefined) {
      return;
    }
  }
  throw new Error("skeleton did not finish");
};

export interface ThreadRow {
  readonly from_address: string;
  readonly has_attachments: number;
  readonly is_in_inbox: number;
  readonly is_in_sent: number;
  readonly is_in_spam: number;
  readonly is_in_trash: number;
  readonly is_unread: number;
  readonly label_ids: string;
  readonly message_count: number;
  readonly snippet: string;
  readonly subject: string;
  readonly thread_id: string;
}

export interface MessageRow {
  readonly attachments: string | null;
  readonly body_html: Buffer | null;
  readonly body_state: string;
  readonly body_text: string | null;
  readonly is_unread: number;
  readonly label_ids: string;
  readonly message_id: string;
  readonly sender_authenticated: number;
  readonly snippet: string;
  readonly thread_id: string;
}

export const threadRow = (threadId: string) =>
  connection
    .prepare(
      `SELECT thread_id, message_count, is_in_inbox, is_in_sent, is_in_spam,
              is_in_trash, is_unread, label_ids, subject, snippet,
              has_attachments, from_address
       FROM mail_threads WHERE account_id = ? AND thread_id = ?`
    )
    .get(accountId, threadId) as ThreadRow | undefined;

export const messageRow = (messageId: string) =>
  connection
    .prepare(
      `SELECT message_id, thread_id, body_state, label_ids, is_unread, snippet,
              body_html, body_text, sender_authenticated, attachments
       FROM mail_messages WHERE account_id = ? AND message_id = ?`
    )
    .get(accountId, messageId) as MessageRow | undefined;

export const resetDatabase = (): void => {
  for (const table of [
    "mail_accounts",
    "mail_inline_images",
    "mail_labels",
    "mail_mailboxes",
    "mail_message_locations",
    "mail_messages",
    "mail_threads",
  ]) {
    connection.exec(`DELETE FROM ${table}`);
  }
};

// ------------------------------------------------------------------ Gmail

export const GMAIL_MAILBOXES = [
  { path: "INBOX" },
  { path: "[Gmail]", selectable: false },
  { path: "[Gmail]/All Mail", specialUse: "\\All" },
  { path: "[Gmail]/Spam", specialUse: "\\Junk" },
  { path: "[Gmail]/Trash", specialUse: "\\Trash" },
  { path: "[Gmail]/Sent Mail", specialUse: "\\Sent" },
  { path: "Work" },
];

export const ALL_MAIL = "[Gmail]/All Mail";
export const TRASH = "[Gmail]/Trash";

export const gmailMessage = (
  id: string,
  thread: string,
  overrides: Partial<FakeMessageInput> = {}
): FakeMessageInput => ({
  envelope: envelope({
    messageId: `<${id}@example.com>`,
    subject: `Subject ${thread}`,
  }),
  flags: ["\\Seen"],
  gmailLabels: ["\\Inbox"],
  gmailMessageId: id,
  gmailThreadId: thread,
  headers: {
    "authentication-results":
      "mx.google.com; dkim=pass header.i=@example.com; dmarc=pass (p=REJECT) header.from=example.com",
  },
  internalDate: Number(id) * 1000,
  sections: { "1": "<p>Hello &amp; <b>welcome</b> =E2=9C=93</p>" },
  structure: {
    encoding: "quoted-printable",
    parameters: { charset: "utf-8" },
    size: 60,
    type: "text/html",
  },
  ...overrides,
});

export const ICLOUD_MAILBOXES = [
  { path: "INBOX" },
  { path: "Sent Messages", specialUse: "\\Sent" },
  { path: "Junk", specialUse: "\\Junk" },
  { path: "Deleted Messages", specialUse: "\\Trash" },
  { path: "Archive", specialUse: "\\Archive" },
  { path: "Receipts" },
];

/**
 * Outlook.com's capabilities as its server lists them before sign-in: no
 * CONDSTORE and no SPECIAL-USE.
 */
export const OUTLOOK_CAPABILITIES = [
  "CHILDREN",
  "ID",
  "IDLE",
  "LITERAL+",
  "MOVE",
  "NAMESPACE",
  "SASL-IR",
  "UIDPLUS",
  "UNSELECT",
];

/** Outlook's folders; their roles come from imapflow's table of names. */
export const OUTLOOK_MAILBOXES = [
  { path: "INBOX" },
  { path: "Sent Items", specialUse: "\\Sent" },
  { path: "Deleted Items", specialUse: "\\Trash" },
  { path: "Junk Email", specialUse: "\\Junk" },
  { path: "Drafts", specialUse: "\\Drafts" },
  { path: "Archive", specialUse: "\\Archive" },
];

export const genericMessage = (
  id: string,
  overrides: Partial<FakeMessageInput> = {}
): FakeMessageInput => ({
  envelope: envelope({ messageId: `<${id}@example.com>`, subject: id }),
  flags: ["\\Seen"],
  internalDate: 1_700_000_000_000,
  ...overrides,
});
