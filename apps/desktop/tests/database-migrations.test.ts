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

/** A database as the first IMAP build left it: the baseline and nothing else. */
const openBaselineDatabase = () => {
  const baselineFolder = makeTemporaryDirectory();
  cpSync(
    path.join(migrationsFolder, BASELINE),
    path.join(baselineFolder, BASELINE),
    { recursive: true }
  );
  const connection = openDatabaseConnection(
    path.join(makeTemporaryDirectory(), "mail.sqlite")
  );
  applyDatabaseMigrations(createDatabaseClient(connection), baselineFolder);
  return connection;
};

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
});
