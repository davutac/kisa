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
    VALUES (
      '5c8cd5c74db86c458eca444811b90c2c38e551b9727a9586e20709982ccc4860',
      1786053026919
    );
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
      ('user@example.com', 'b@example.com', 0, '["ARCHIVE"]', 10, 1, 's', 'Archived thread', 't-archived', 1);
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
      ]);
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
});
