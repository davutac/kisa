import { fileURLToPath } from "node:url";

import {
  applyDatabaseMigrations,
  createDatabaseClient,
  openDatabaseConnection,
} from "@repo/database/client";
import { createRemoteDatabaseClient } from "@repo/database/remote-client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { runIndexedThreadSearchRemote } from "../src/main/mail/mail-search";

vi.mock(import("../src/main/database"), () => ({
  withDatabaseClient: () => {
    throw new Error("Unexpected global database access");
  },
}));

const connection = openDatabaseConnection(":memory:");
const database = createDatabaseClient(connection);
const remoteDatabase = createRemoteDatabaseClient(
  (query, parameters, method) => {
    const statement = connection.prepare(query).raw(true);

    if (method === "run") {
      statement.run(...parameters);
      return Promise.resolve({ rows: [] });
    }

    if (method === "get") {
      const row = statement.get(...parameters);

      return Promise.resolve({ rows: row === undefined ? [] : [row] });
    }

    return Promise.resolve({ rows: statement.all(...parameters) });
  }
);

describe(runIndexedThreadSearchRemote, () => {
  beforeAll(() => {
    applyDatabaseMigrations(
      database,
      fileURLToPath(
        new URL("../../../packages/database/drizzle", import.meta.url)
      )
    );
    const insert = connection.prepare(`
      INSERT INTO gmail_threads (
        account_email, "from", is_in_inbox, is_unread, labels, latest_at,
        message_count, snippet, subject, thread_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      "one@example.com",
      "inbox@example.com",
      1,
      1,
      '["INBOX","Important"]',
      2,
      1,
      "Inbox thread",
      "Inbox thread",
      "inbox-thread",
      2
    );
    insert.run(
      "one@example.com",
      "archive@example.com",
      0,
      1,
      '["Important"]',
      1,
      1,
      "Archived thread",
      "Archived thread",
      "archived-thread",
      1
    );
  });

  afterAll(() => {
    connection.close();
  });

  it("matches system and user label names case-insensitively", async () => {
    const inbox = await runIndexedThreadSearchRemote(remoteDatabase, {
      accountIds: ["one@example.com"],
      filters: [{ field: "label", value: "inbox" }],
    });
    const important = await runIndexedThreadSearchRemote(remoteDatabase, {
      accountIds: ["one@example.com"],
      filters: [{ field: "label", value: "important" }],
    });

    expect(inbox.threads.map(({ threadId }) => threadId)).toStrictEqual([
      "inbox-thread",
    ]);
    expect(important.threads.map(({ threadId }) => threadId)).toStrictEqual([
      "inbox-thread",
      "archived-thread",
    ]);
  });
});
