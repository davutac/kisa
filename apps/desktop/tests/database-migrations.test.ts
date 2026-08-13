import { mkdtempSync, rmSync } from "node:fs";
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

const createLegacyDatabase = () => {
  const directory = mkdtempSync(path.join(tmpdir(), "kisa-migration-"));
  const connection = openDatabaseConnection(path.join(directory, "app.sqlite"));

  temporaryDirectories.push(directory);
  connection.exec(`
    CREATE TABLE "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    );
    INSERT INTO "__drizzle_migrations" (hash, created_at)
    VALUES
      ('9f79c2de858fd84cd6ecbceb148491961c7f2dff8d6f67d7e1343053ad14f891', 1777491900375),
      ('81e1101cdfb3af7f3aac611fad3cd74587816d9580a764b83105f5de4bba4630', 1786034147254),
      ('efdab5a8371e6f13c737d64d9ea41a984bbec806403f2a222a0f00b04b6889a9', 1786037347379),
      ('aa74875a01bdd9d1883f746ace1ff4764ccb0a877da65109e33fc208d5509c70', 1786039655116),
      ('c1873b78f738e2d28eaa30e3c8f0f1b8dfad32a128d0c69a71ee719a5401331e', 1786040185904),
      ('048de4d537a6e2c151c236637078997c7695cfad886a778b2433f1e09b1ac340', 1786043976396),
      ('01eac87b103902f053bd336b735caad86adeda1f930b2626be94c4bce209a184', 1786044374073),
      ('b12684e47a2bcc5cd944ee6b7cc1d13e318ea06f1e7cbeb722b58f35ab651efe', 1786048788803),
      ('0890bf99d966ac1f9954126c358b5bbfe8acc81223e93fcc151e8f25331b338b', 1786050816456),
      ('5c8cd5c74db86c458eca444811b90c2c38e551b9727a9586e20709982ccc4860', 1786053026919);
    CREATE TABLE google_accounts (
      avatar_url text,
      created_at integer NOT NULL,
      credentials blob NOT NULL,
      display_name text,
      email text PRIMARY KEY NOT NULL,
      scopes text NOT NULL,
      updated_at integer NOT NULL
    );
    INSERT INTO google_accounts (
      created_at,
      credentials,
      email,
      scopes,
      updated_at
    ) VALUES
      (20, X'00', 'second@example.com', '[]', 20),
      (10, X'00', 'first@example.com', '[]', 10);
    CREATE TABLE gmail_labels (
      account_email text NOT NULL,
      label_id text NOT NULL,
      name text NOT NULL,
      type text,
      updated_at integer NOT NULL,
      PRIMARY KEY (account_email, label_id)
    );
    INSERT INTO gmail_labels (
      account_email,
      label_id,
      name,
      type,
      updated_at
    ) VALUES (
      'user@example.com',
      'Label_1',
      'Receipts',
      'user',
      1
    );
    CREATE TABLE gmail_threads (
      account_email text NOT NULL,
      attachments text,
      "from" text NOT NULL,
      has_attachments integer,
      is_unread integer NOT NULL,
      labels text,
      latest_at integer NOT NULL,
      message_count integer NOT NULL,
      snippet text NOT NULL,
      subject text NOT NULL,
      thread_id text NOT NULL,
      updated_at integer NOT NULL,
      PRIMARY KEY (account_email, thread_id)
    );
    CREATE TABLE gmail_sync_state (
      account_email text PRIMARY KEY NOT NULL,
      history_id text NOT NULL,
      updated_at integer NOT NULL
    );
    INSERT INTO gmail_threads (
      account_email,
      "from",
      is_unread,
      labels,
      latest_at,
      message_count,
      snippet,
      subject,
      thread_id,
      updated_at
    ) VALUES
      ('user@example.com', 'a@example.com', 0, '["INBOX","IMPORTANT"]', 20, 1, 's', 'Inbox thread', 't-inbox', 1),
      ('user@example.com', 'b@example.com', 0, '["ARCHIVE"]', 10, 1, 's', 'Archived thread', 't-archived', 1),
      ('user@example.com', 'c@example.com', 1, '["SPAM","UNREAD"]', 30, 1, 's', 'Spam thread', 't-spam', 1);
    CREATE TABLE gmail_sender_brands (
      authority_url text,
      domain text PRIMARY KEY NOT NULL,
      expires_at integer NOT NULL,
      logo_data blob,
      logo_url text,
      status text NOT NULL,
      updated_at integer NOT NULL
    );
    INSERT INTO gmail_sender_brands (
      authority_url,
      domain,
      expires_at,
      logo_data,
      logo_url,
      status,
      updated_at
    ) VALUES (
      NULL,
      'example.com',
      1,
      NULL,
      'https://example.com/logo.svg',
      'available',
      1
    );
  `);

  return connection;
};

describe("database migrations", () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("upgrades the original sender-brand table without losing cached brands", () => {
    const connection = createLegacyDatabase();

    try {
      applyDatabaseMigrations(
        createDatabaseClient(connection),
        migrationsFolder
      );

      expect(
        connection
          .prepare("SELECT domain, selector, status FROM gmail_sender_brands")
          .all()
      ).toStrictEqual([
        {
          domain: "example.com",
          selector: "default",
          status: "available",
        },
      ]);
    } finally {
      connection.close();
    }
  });

  it("derives is_in_inbox for threads cached before the column existed", () => {
    const connection = createLegacyDatabase();

    try {
      applyDatabaseMigrations(
        createDatabaseClient(connection),
        migrationsFolder
      );

      expect(
        connection
          .prepare(
            "SELECT thread_id, is_in_inbox FROM gmail_threads ORDER BY thread_id"
          )
          .all()
      ).toStrictEqual([
        { is_in_inbox: 0, thread_id: "t-archived" },
        { is_in_inbox: 1, thread_id: "t-inbox" },
        { is_in_inbox: 0, thread_id: "t-spam" },
      ]);
    } finally {
      connection.close();
    }
  });

  it("derives the Spam mailbox state for previously cached threads", () => {
    const connection = createLegacyDatabase();

    try {
      applyDatabaseMigrations(
        createDatabaseClient(connection),
        migrationsFolder
      );

      expect(
        connection
          .prepare(
            `SELECT is_in_spam, spam_added_at
             FROM gmail_threads
             WHERE thread_id = 't-spam'`
          )
          .get()
      ).toStrictEqual({ is_in_spam: 1, spam_added_at: 1 });
    } finally {
      connection.close();
    }
  });

  it("preserves account creation order when adding persisted sorting", () => {
    const connection = createLegacyDatabase();

    try {
      applyDatabaseMigrations(
        createDatabaseClient(connection),
        migrationsFolder
      );

      expect(
        connection
          .prepare(
            "SELECT email, sort_order FROM google_accounts ORDER BY sort_order"
          )
          .all()
      ).toStrictEqual([
        { email: "first@example.com", sort_order: 10 },
        { email: "second@example.com", sort_order: 20 },
      ]);
    } finally {
      connection.close();
    }
  });

  it("enables notifications by default for existing account settings", () => {
    const connection = createLegacyDatabase();

    try {
      applyDatabaseMigrations(
        createDatabaseClient(connection),
        migrationsFolder
      );
      connection
        .prepare(
          `INSERT INTO account_settings (
            account_email,
            show_system_labels,
            updated_at
          ) VALUES (?, ?, ?)`
        )
        .run("user@example.com", 1, 1);

      expect(
        connection
          .prepare(
            "SELECT notifications_enabled FROM account_settings WHERE account_email = ?"
          )
          .get("user@example.com")
      ).toStrictEqual({ notifications_enabled: 1 });
    } finally {
      connection.close();
    }
  });

  it("adds a singleton store for customizable AI writing settings", () => {
    const connection = createLegacyDatabase();

    try {
      applyDatabaseMigrations(
        createDatabaseClient(connection),
        migrationsFolder
      );
      connection
        .prepare(
          `INSERT INTO ai_settings (
            active_provider,
            claude_model,
            cleanup_instructions,
            codex_model,
            id,
            opencode_model,
            reply_instructions,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "codex",
          "claude-sonnet-5",
          "Cleanup",
          "gpt-5.6-luna",
          1,
          "openai/gpt-5",
          "Reply",
          1
        );

      expect(
        connection
          .prepare(
            `SELECT active_provider, claude_model, codex_model,
                    cleanup_instructions, opencode_model, reply_instructions
             FROM ai_settings
             WHERE id = 1`
          )
          .get()
      ).toStrictEqual({
        active_provider: "codex",
        claude_model: "claude-sonnet-5",
        cleanup_instructions: "Cleanup",
        codex_model: "gpt-5.6-luna",
        opencode_model: "openai/gpt-5",
        reply_instructions: "Reply",
      });
    } finally {
      connection.close();
    }
  });

  it("adds label colors without losing the existing catalog", () => {
    const connection = createLegacyDatabase();

    try {
      applyDatabaseMigrations(
        createDatabaseClient(connection),
        migrationsFolder
      );

      expect(
        connection
          .prepare(
            `SELECT background_color, label_id, name, text_color
             FROM gmail_labels`
          )
          .get()
      ).toStrictEqual({
        background_color: null,
        label_id: "Label_1",
        name: "Receipts",
        text_color: null,
      });
    } finally {
      connection.close();
    }
  });
});
