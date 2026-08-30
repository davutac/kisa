// oxlint-disable typescript/no-unsafe-type-assertion
import { fileURLToPath } from "node:url";

import {
  applyDatabaseMigrations,
  createDatabaseClient,
  openDatabaseConnection,
} from "@repo/database/client";
import type { DatabaseRemoteCallback } from "@repo/database/remote-client";
import { createRemoteDatabaseClient } from "@repo/database/remote-client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { resetMailIndexRemote } from "../src/main/mail/mail-index-reindex";

const connection = openDatabaseConnection(":memory:");
applyDatabaseMigrations(
  createDatabaseClient(connection),
  fileURLToPath(new URL("../../../packages/database/drizzle", import.meta.url))
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
    const row = dataStatement.get(...parameters);
    return Promise.resolve({ rows: row as never[] });
  }

  return Promise.resolve({ rows: dataStatement.all(...parameters) });
};

const database = createRemoteDatabaseClient(executeRemoteQuery);
const insertAccount = connection.prepare(
  `INSERT INTO google_accounts (
    created_at, credentials, email, scopes, sort_order, updated_at
  ) VALUES (1, x'01', ?, '[]', 1, 1)`
);
const insertIndexState = connection.prepare(
  `INSERT INTO gmail_backfill_state (
    account_email, completed_at, status, updated_at
  ) VALUES (?, 2, 'complete', 2)`
);
const insertThread = connection.prepare(
  `INSERT INTO gmail_threads (
    account_email, "from", is_in_inbox, is_in_sent, is_in_spam, is_unread,
    latest_at, message_count, snippet, subject, thread_id, updated_at
  ) VALUES (?, 'sender@example.com', 1, 0, 0, 0, 1, 1, '', 'Subject', ?, 1)`
);
const insertMessage = connection.prepare(
  `INSERT INTO gmail_messages (
    account_email, from_address, internal_date, message_id, schema_version,
    subject, thread_id, updated_at
  ) VALUES (?, 'sender@example.com', 1, ?, 1, 'Subject', ?, 1)`
);

describe(resetMailIndexRemote, () => {
  beforeEach(() => {
    connection.prepare("DELETE FROM gmail_messages").run();
    connection.prepare("DELETE FROM gmail_threads").run();
    connection.prepare("DELETE FROM gmail_backfill_state").run();
    connection.prepare("DELETE FROM account_settings").run();
    connection.prepare("DELETE FROM google_accounts").run();

    for (const accountId of ["one@example.com", "two@example.com"]) {
      insertAccount.run(accountId);
      insertIndexState.run(accountId);
      insertThread.run(accountId, "thread-1");
      insertMessage.run(accountId, "message-1", "thread-1");
    }
  });

  afterAll(() => connection.close());

  it("restarts only the selected account with indeterminate progress and preserves cached mail", async () => {
    await resetMailIndexRemote(database, "one@example.com");

    const indexStates = connection
      .prepare(
        `SELECT account_email, completed_at, estimated_threads,
                indexed_messages, indexed_threads, oldest_indexed_at,
                page_token, started_at, status
         FROM gmail_backfill_state
         ORDER BY account_email`
      )
      .all();

    expect(indexStates).toStrictEqual([
      {
        account_email: "one@example.com",
        completed_at: null,
        estimated_threads: 0,
        indexed_messages: 0,
        indexed_threads: 0,
        oldest_indexed_at: null,
        page_token: null,
        started_at: null,
        status: "running",
      },
      {
        account_email: "two@example.com",
        completed_at: 2,
        estimated_threads: null,
        indexed_messages: 0,
        indexed_threads: 0,
        oldest_indexed_at: null,
        page_token: null,
        started_at: null,
        status: "complete",
      },
    ]);
    expect(
      connection
        .prepare(
          "SELECT account_email, thread_id FROM gmail_threads ORDER BY account_email"
        )
        .all()
    ).toStrictEqual([
      { account_email: "one@example.com", thread_id: "thread-1" },
      { account_email: "two@example.com", thread_id: "thread-1" },
    ]);
    expect(
      connection
        .prepare(
          "SELECT account_email, message_id FROM gmail_messages ORDER BY account_email"
        )
        .all()
    ).toStrictEqual([
      { account_email: "one@example.com", message_id: "message-1" },
      { account_email: "two@example.com", message_id: "message-1" },
    ]);
  });
});
