import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyDatabaseMigrations,
  createDatabaseClient,
  openDatabaseConnection,
} from "../../../packages/database/src/client";

const migrationsFolder = fileURLToPath(
  new URL("../../../packages/database/drizzle", import.meta.url)
);
const temporaryDirectories: string[] = [];

const BASELINE = "20261121231100_baseline";
const DROP_OAUTH_COLUMNS = "20261122102513_drop_oauth_columns";
const FLAG_CURSOR = "20261122123610_flag_cursor";

const makeTemporaryDirectory = () => {
  const directory = mkdtempSync(path.join(tmpdir(), "kisa-migration-"));
  temporaryDirectories.push(directory);
  return directory;
};

const openMigratedDatabase = () => {
  const connection = openDatabaseConnection(
    path.join(makeTemporaryDirectory(), "mail.sqlite")
  );
  applyDatabaseMigrations(createDatabaseClient(connection), migrationsFolder);
  return connection;
};

/** A database an earlier build left, migrated only as far as `migrations`. */
const openDatabaseWith = (...migrations: readonly string[]) => {
  const earlierFolder = makeTemporaryDirectory();
  for (const migration of migrations) {
    cpSync(
      path.join(migrationsFolder, migration),
      path.join(earlierFolder, migration),
      { recursive: true }
    );
  }
  const connection = openDatabaseConnection(
    path.join(makeTemporaryDirectory(), "mail.sqlite")
  );
  applyDatabaseMigrations(createDatabaseClient(connection), earlierFolder);
  return connection;
};

/** A database as the first IMAP build left it: the baseline and nothing else. */
const openBaselineDatabase = () => openDatabaseWith(BASELINE);

const insertMessage = (
  connection: ReturnType<typeof openDatabaseConnection>,
  messageId: string,
  subject: string,
  bodyText: string
) =>
  connection
    .prepare(
      `INSERT INTO mail_messages (account_id, bcc_addresses, body_text,
        cc_addresses, from_address, is_draft, is_starred, is_unread, label_ids,
        message_id, received_at, size, subject, thread_id, to_addresses,
        updated_at)
       VALUES ('a@example.com', '[]', ?, '[]', 'sender@example.com', 0, 0, 1,
        '["INBOX"]', ?, 1, 1, ?, 't', '[]', 1)`
    )
    .run(bodyText, messageId, subject);

const matches = (
  connection: ReturnType<typeof openDatabaseConnection>,
  term: string
) =>
  connection
    .prepare(
      `SELECT m.message_id AS messageId FROM mail_messages_fts f
       JOIN mail_messages m ON m.rowid = f.rowid
       WHERE mail_messages_fts MATCH ? ORDER BY m.message_id`
    )
    .all(term);

/**
 * A database the previous build left, with a non-Gmail account and a
 * Gmail one, each holding a downloaded body, and the non-Gmail one also
 * a failed body and one never downloaded.
 */
const openDatabaseWithBodies = () => {
  const connection = openDatabaseWith(
    BASELINE,
    DROP_OAUTH_COLUMNS,
    FLAG_CURSOR
  );
  const insertAccount = connection.prepare(
    `INSERT INTO mail_accounts (account_id, created_at, credentials,
      dialect, email, imap_host, imap_port, imap_security, provider,
      smtp_host, smtp_port, smtp_security, sort_order, updated_at,
      username)
     VALUES (?, 0, X'00', ?, ?, 'imap.example.com', 993, 'tls', ?,
      'smtp.example.com', 465, 'tls', 0, 0, ?)`
  );
  insertAccount.run(
    "g@example.com",
    "generic",
    "g@example.com",
    "icloud",
    "g@example.com"
  );
  insertAccount.run(
    "m@gmail.com",
    "gmail",
    "m@gmail.com",
    "gmail",
    "m@gmail.com"
  );
  const insertBody = connection.prepare(
    `INSERT INTO mail_messages (account_id, attachments, bcc_addresses,
      body_html, body_state, body_text, cc_addresses, from_address,
      has_attachments, has_blocked_remote_images, headers, is_draft,
      is_starred, is_unread, label_ids, message_id, received_at,
      schema_version, sender_authenticated, size, snippet, subject,
      thread_id, to_addresses, updated_at)
     VALUES (?, '[{"filename":"a.pdf","mediaType":"application/pdf","section":"2","size":1}]',
      '[]', X'00', ?, ?, '[]', 'sender@example.com', 1, 1,
      '[{"name":"List-Unsubscribe","value":"<x>"}]', 0, 0, 1,
      '["INBOX"]', ?, 1, 3, 1, 1, ?, ?, 't', '[]', 1)`
  );
  insertBody.run(
    "g@example.com",
    "ready",
    "wrongbody",
    "g-ready",
    "wrongbody",
    "Genericsubject"
  );
  insertBody.run(
    "g@example.com",
    "failed",
    null,
    "g-failed",
    "",
    "Failedsubject"
  );
  insertBody.run(
    "m@gmail.com",
    "ready",
    "gmailbody",
    "m-ready",
    "gmailbody",
    "Gmailsubject"
  );
  connection
    .prepare(
      `INSERT INTO mail_messages (account_id, bcc_addresses, body_state,
        cc_addresses, from_address, is_draft, is_starred, is_unread,
        label_ids, message_id, received_at, size, subject, thread_id,
        to_addresses, updated_at)
       VALUES ('g@example.com', '[]', 'none', '[]', 'sender@example.com',
        0, 0, 1, '["INBOX"]', 'g-none', 1, 1, 'Pending', 't', '[]', 1)`
    )
    .run();
  const insertThread = connection.prepare(
    `INSERT INTO mail_threads (account_id, attachments, from_address,
      has_attachments, is_in_inbox, is_in_sent, is_in_spam, is_in_trash,
      is_unread, label_ids, latest_at, latest_message_id, message_count,
      snippet, subject, thread_id, updated_at)
     VALUES (?, '[{"filename":"a.pdf"}]', 'sender@example.com', 1, 1, 0, 0,
      0, 1, '["INBOX"]', 1, ?, 1, ?, 'Subject', 't', 1)`
  );
  insertThread.run("g@example.com", "g-ready", "wrongbody");
  insertThread.run("m@gmail.com", "m-ready", "gmailbody");

  applyDatabaseMigrations(createDatabaseClient(connection), migrationsFolder);
  return connection;
};

const bodyOf = (
  connection: ReturnType<typeof openDatabaseConnection>,
  messageId: string
) =>
  connection
    .prepare(
      `SELECT attachments, body_html AS bodyHtml, body_state AS bodyState,
              body_text AS bodyText, has_attachments AS hasAttachments,
              has_blocked_remote_images AS hasBlockedRemoteImages,
              headers, schema_version AS schemaVersion,
              sender_authenticated AS senderAuthenticated, snippet
       FROM mail_messages WHERE message_id = ?`
    )
    .get(messageId);

describe("database baseline", () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("creates the mail engine's tables, and applying it again changes nothing", () => {
    const connection = openMigratedDatabase();
    applyDatabaseMigrations(createDatabaseClient(connection), migrationsFolder);

    const tables = connection
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'mail_%' AND name NOT LIKE 'mail_messages_fts_%' ORDER BY name"
      )
      .all();

    expect(tables).toStrictEqual(
      [
        "mail_accounts",
        "mail_drafts",
        "mail_labels",
        "mail_mailboxes",
        "mail_message_locations",
        "mail_messages",
        "mail_messages_fts",
        "mail_sender_brands",
        "mail_threads",
        "mail_trusted_image_senders",
      ].map((name) => ({ name }))
    );
  });

  it("keeps full-text search in step as messages are written and deleted", () => {
    const connection = openMigratedDatabase();
    insertMessage(connection, "m1", "Quarterly report", "numbers inside");
    insertMessage(connection, "m2", "Lunch", "café on friday");

    expect(matches(connection, "quarterly")).toStrictEqual([
      { messageId: "m1" },
    ]);
    // Diacritics are folded, so "cafe" finds "café".
    expect(matches(connection, "cafe")).toStrictEqual([{ messageId: "m2" }]);

    connection
      .prepare(
        "UPDATE mail_messages SET subject = 'Annual report' WHERE message_id = 'm1'"
      )
      .run();
    connection
      .prepare(
        "UPDATE mail_messages SET label_ids = '[]' WHERE message_id = 'm2'"
      )
      .run();
    connection
      .prepare("DELETE FROM mail_messages WHERE message_id = 'm2'")
      .run();

    expect(matches(connection, "quarterly")).toStrictEqual([]);
    expect(matches(connection, "annual")).toStrictEqual([{ messageId: "m1" }]);
    expect(matches(connection, "friday")).toStrictEqual([]);
  });

  it("drops the sign-in kind and avatars but keeps the account and its templates", () => {
    const connection = openBaselineDatabase();
    connection
      .prepare(
        `INSERT INTO mail_accounts (account_id, auth_kind, avatar_url,
          created_at, credentials, dialect, display_name, email, imap_host,
          imap_port, imap_security, provider, smtp_host, smtp_port,
          smtp_security, sort_order, updated_at, username)
         VALUES ('a@example.com', 'password', 'https://example.com/a.png', 1,
          x'00', 'generic', 'A', 'a@example.com', 'imap.example.com', 993,
          'tls', 'imap', 'smtp.example.com', 465, 'tls', 1, 1, 'a@example.com')`
      )
      .run();
    connection
      .prepare(
        `INSERT INTO composer_templates (account_email, bcc, body_html,
          body_text, cc, created_at, id, name, subject, "to", updated_at)
         VALUES ('a@example.com', '[]', '', '', '[]', 1, 't1', 'Hello', '',
          '[]', 1)`
      )
      .run();

    applyDatabaseMigrations(createDatabaseClient(connection), migrationsFolder);

    const columns = connection
      .prepare("SELECT name FROM pragma_table_info('mail_accounts')")
      .all()
      .map((column) => (column as { name: string }).name);
    expect(columns).not.toContain("auth_kind");
    expect(columns.filter((name) => name.startsWith("avatar_"))).toStrictEqual(
      []
    );
    expect(
      connection
        .prepare("SELECT account_id, display_name FROM mail_accounts")
        .all()
    ).toStrictEqual([{ account_id: "a@example.com", display_name: "A" }]);
    expect(
      connection.prepare("SELECT account_email FROM composer_templates").all()
    ).toStrictEqual([{ account_email: "a@example.com" }]);
  });

  it("adds an empty flag cursor to mailboxes, keeping their sync progress", () => {
    const connection = openDatabaseWith(BASELINE, DROP_OAUTH_COLUMNS);
    connection
      .prepare(
        `INSERT INTO mail_mailboxes (account_id, delimiter, path, role,
          selectable, skeleton_floor, synced, uid_next, uid_validity,
          updated_at)
         VALUES ('a@example.com', '/', 'INBOX', 'inbox', 1, 1, 1, 42, '7', 1)`
      )
      .run();

    applyDatabaseMigrations(createDatabaseClient(connection), migrationsFolder);

    expect(
      connection
        .prepare(
          "SELECT path, flag_cursor, skeleton_floor, uid_next FROM mail_mailboxes"
        )
        .all()
    ).toStrictEqual([
      { flag_cursor: null, path: "INBOX", skeleton_floor: 1, uid_next: 42 },
    ]);
  });

  describe("resetting bodies on non-Gmail accounts", () => {
    const CLEARED = {
      attachments: null,
      bodyHtml: null,
      bodyState: "none",
      bodyText: null,
      hasAttachments: 0,
      hasBlockedRemoteImages: 0,
      headers: null,
      schemaVersion: 0,
      senderAuthenticated: 0,
      snippet: "",
    };

    it("clears every downloaded or failed body on a non-Gmail account, and nothing on Gmail", () => {
      const connection = openDatabaseWithBodies();

      expect(bodyOf(connection, "g-ready")).toStrictEqual(CLEARED);
      expect(bodyOf(connection, "g-failed")).toStrictEqual(CLEARED);
      expect(bodyOf(connection, "g-none")).toMatchObject({
        bodyState: "none",
        snippet: "",
      });
      expect(bodyOf(connection, "m-ready")).toMatchObject({
        bodyState: "ready",
        bodyText: "gmailbody",
        senderAuthenticated: 1,
      });
    });

    it("stops finding the cleared text, while subjects and Gmail bodies are still found", () => {
      const connection = openDatabaseWithBodies();

      expect(matches(connection, "wrongbody")).toStrictEqual([]);
      expect(matches(connection, "Genericsubject")).toStrictEqual([
        { messageId: "g-ready" },
      ]);
      expect(matches(connection, "gmailbody")).toStrictEqual([
        { messageId: "m-ready" },
      ]);
    });

    it("clears the list's snippet and attachments for the non-Gmail account only", () => {
      const connection = openDatabaseWithBodies();

      expect(
        connection
          .prepare(
            `SELECT account_id AS accountId, attachments,
                    has_attachments AS hasAttachments, snippet
             FROM mail_threads ORDER BY account_id`
          )
          .all()
      ).toStrictEqual([
        {
          accountId: "g@example.com",
          attachments: "[]",
          hasAttachments: 0,
          snippet: "",
        },
        {
          accountId: "m@gmail.com",
          attachments: '[{"filename":"a.pdf"}]',
          hasAttachments: 1,
          snippet: "gmailbody",
        },
      ]);
    });
  });
});
