import { fileURLToPath } from "node:url";

import {
  applyDatabaseMigrations,
  createDatabaseClient,
  openDatabaseConnection,
} from "@repo/database/client";
import type { DatabaseRemoteCallback } from "@repo/database/remote-client";
import { createRemoteDatabaseClient } from "@repo/database/remote-client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { listCachedThreadPageFromDatabase } from "../src/main/mail/mailbox-page";

vi.mock(import("../src/main/database"), () => ({
  withDatabaseClient: () => {
    throw new Error("Unexpected global database access");
  },
}));

const connection = openDatabaseConnection(":memory:");
const database = createDatabaseClient(connection);
const executeRemoteQuery: DatabaseRemoteCallback = (
  query,
  parameters,
  method
) => {
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
};
const remoteDatabase = createRemoteDatabaseClient(executeRemoteQuery);

const insertThread = (
  accountId: string,
  threadId: string,
  latestAt: number,
  labels: readonly string[],
  isUnread = false
): void => {
  connection
    .prepare(
      `INSERT INTO gmail_threads (
        account_email, "from", is_in_inbox, is_in_spam, is_unread, labels,
        latest_at, message_count, snippet, subject, thread_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      accountId,
      "sender@example.com",
      Number(labels.includes("INBOX")),
      Number(labels.includes("SPAM")),
      Number(isUnread),
      JSON.stringify(labels),
      latestAt,
      1,
      threadId,
      threadId,
      threadId,
      latestAt
    );
};

describe(listCachedThreadPageFromDatabase, () => {
  beforeAll(() => {
    applyDatabaseMigrations(
      database,
      fileURLToPath(
        new URL("../../../packages/database/drizzle", import.meta.url)
      )
    );
  });

  beforeEach(() => {
    connection.prepare("DELETE FROM gmail_threads").run();
    insertThread(
      "one@example.com",
      "both-inbox",
      500,
      ["INBOX", "Work", "Travel"],
      true
    );
    insertThread("one@example.com", "work-inbox", 400, ["INBOX", "Work"]);
    insertThread(
      "one@example.com",
      "both-spam",
      300,
      ["SPAM", "Work", "Travel"],
      true
    );
    insertThread(
      "two@example.com",
      "both-inbox",
      200,
      ["INBOX", "work", "travel"],
      true
    );
  });

  afterAll(() => connection.close());

  it("matches every selected label inside account and unread scope", async () => {
    const result = await listCachedThreadPageFromDatabase(remoteDatabase, {
      accountIds: ["one@example.com"],
      labelNames: ["travel", "WORK"],
      mailbox: "inbox",
      unreadOnly: true,
    });

    expect(result.threads.map(({ threadId }) => threadId)).toStrictEqual([
      "both-inbox",
    ]);
  });

  it("keeps Spam separate and account-qualifies colliding ids", async () => {
    const spam = await listCachedThreadPageFromDatabase(remoteDatabase, {
      accountIds: ["one@example.com", "two@example.com"],
      labelNames: ["work", "travel"],
      mailbox: "spam",
    });
    const inbox = await listCachedThreadPageFromDatabase(remoteDatabase, {
      accountIds: ["one@example.com", "two@example.com"],
      labelNames: ["work", "travel"],
      mailbox: "inbox",
    });

    expect(
      spam.threads.map(({ accountId, threadId }) => `${accountId}:${threadId}`)
    ).toStrictEqual(["one@example.com:both-spam"]);
    expect(
      inbox.threads.map(({ accountId, threadId }) => `${accountId}:${threadId}`)
    ).toStrictEqual([
      "one@example.com:both-inbox",
      "two@example.com:both-inbox",
    ]);
  });

  it("applies the keyset cursor after label filtering", async () => {
    const result = await listCachedThreadPageFromDatabase(remoteDatabase, {
      accountIds: ["one@example.com", "two@example.com"],
      cursor: {
        accountId: "one@example.com",
        latestAt: 500,
        threadId: "both-inbox",
      },
      labelNames: ["work", "travel"],
      mailbox: "inbox",
    });

    expect(result.threads.map(({ accountId }) => accountId)).toStrictEqual([
      "two@example.com",
    ]);
  });
});
