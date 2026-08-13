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

import {
  hasUnreadSpamRemote,
  resetSpamBackfillRemote,
} from "../src/main/mail/spam-mailbox";

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
const insertThread = connection.prepare(
  `INSERT INTO gmail_threads (
    account_email, "from", is_in_inbox, is_in_spam, is_unread, labels,
    latest_at, message_count, snippet, spam_added_at, subject, thread_id,
    updated_at
  ) VALUES (?, 'sender@example.com', ?, ?, ?, ?, 1, 1, '', ?, 'Subject', ?, 1)`
);
const insertMessage = connection.prepare(
  `INSERT INTO gmail_messages (
    account_email, from_address, internal_date, label_ids, message_id,
    schema_version, subject, thread_id, updated_at
  ) VALUES (?, 'sender@example.com', 1, ?, ?, 1, 'Subject', ?, 1)`
);

describe("Spam mailbox persistence", () => {
  beforeEach(() => {
    connection.prepare("DELETE FROM gmail_messages").run();
    connection.prepare("DELETE FROM gmail_threads").run();
    connection.prepare("DELETE FROM gmail_sync_state").run();
    connection.prepare("DELETE FROM account_settings").run();
    connection.prepare("DELETE FROM google_accounts").run();
    insertAccount.run("one@example.com");
    insertAccount.run("two@example.com");
  });

  afterAll(() => connection.close());

  it("does not combine Spam and unread labels from different messages", async () => {
    insertThread.run(
      "one@example.com",
      0,
      1,
      1,
      '["SPAM","UNREAD"]',
      100,
      "spam-1"
    );
    insertMessage.run("one@example.com", '["SPAM"]', "message-a", "spam-1");
    insertMessage.run(
      "one@example.com",
      '["INBOX","UNREAD"]',
      "message-b",
      "spam-1"
    );

    await expect(
      hasUnreadSpamRemote(database, ["one@example.com"])
    ).resolves.toBeFalsy();
  });

  it("finds Spam and unread labels on the same message", async () => {
    insertThread.run(
      "one@example.com",
      0,
      1,
      1,
      '["SPAM","UNREAD"]',
      100,
      "spam-1"
    );
    insertMessage.run(
      "one@example.com",
      '["SPAM","UNREAD"]',
      "message-a",
      "spam-1"
    );

    await expect(
      hasUnreadSpamRemote(database, ["one@example.com"])
    ).resolves.toBeTruthy();
  });

  it("does not treat thread projection flags as badge eligibility", async () => {
    insertThread.run(
      "one@example.com",
      0,
      1,
      1,
      '["SPAM","UNREAD"]',
      100,
      "spam-1"
    );

    await expect(
      hasUnreadSpamRemote(database, ["one@example.com"])
    ).resolves.toBeFalsy();
  });

  it("tracks unread Spam independently for each connected account", async () => {
    insertThread.run(
      "one@example.com",
      0,
      1,
      1,
      '["SPAM","UNREAD"]',
      100,
      "shared-thread"
    );
    insertThread.run(
      "two@example.com",
      0,
      1,
      1,
      '["SPAM","UNREAD"]',
      100,
      "shared-thread"
    );
    insertMessage.run(
      "one@example.com",
      '["SPAM"]',
      "message-a",
      "shared-thread"
    );
    insertMessage.run(
      "two@example.com",
      '["SPAM","UNREAD"]',
      "message-b",
      "shared-thread"
    );

    await expect(
      hasUnreadSpamRemote(database, ["one@example.com"])
    ).resolves.toBeFalsy();
    await expect(
      hasUnreadSpamRemote(database, ["two@example.com"])
    ).resolves.toBeTruthy();
    await expect(
      hasUnreadSpamRemote(database, ["missing@example.com"])
    ).resolves.toBeFalsy();
  });

  it("resets the Spam cache and cursor in one account-scoped transaction", async () => {
    connection
      .prepare(
        `INSERT INTO gmail_sync_state (
          account_email, history_id, spam_backfill_complete,
          spam_backfill_cursor, updated_at
        ) VALUES ('one@example.com', '10', 1, 'cursor', 1)`
      )
      .run();
    insertThread.run(
      "one@example.com",
      0,
      1,
      1,
      '["SPAM","UNREAD"]',
      100,
      "spam-1"
    );
    insertThread.run(
      "one@example.com",
      1,
      0,
      1,
      '["INBOX","UNREAD"]',
      null,
      "inbox-1"
    );
    insertMessage.run(
      "one@example.com",
      '["SPAM","UNREAD"]',
      "spam-message",
      "spam-1"
    );
    insertMessage.run(
      "one@example.com",
      '["INBOX","UNREAD"]',
      "inbox-message",
      "inbox-1"
    );

    await expect(
      resetSpamBackfillRemote(database, "one@example.com", 500)
    ).resolves.toStrictEqual(["spam-1"]);
    expect(
      connection
        .prepare("SELECT thread_id FROM gmail_threads ORDER BY thread_id ASC")
        .all()
    ).toStrictEqual([{ thread_id: "inbox-1" }]);
    expect(
      connection
        .prepare(
          "SELECT message_id FROM gmail_messages ORDER BY message_id ASC"
        )
        .all()
    ).toStrictEqual([{ message_id: "inbox-message" }]);
    expect(
      connection
        .prepare(
          `SELECT spam_backfill_complete, spam_backfill_cursor, updated_at
           FROM gmail_sync_state
           WHERE account_email = 'one@example.com'`
        )
        .get()
    ).toStrictEqual({
      spam_backfill_complete: 0,
      spam_backfill_cursor: null,
      updated_at: 500,
    });
  });
});
