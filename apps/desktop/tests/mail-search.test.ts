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

import {
  forgetCachedCorrespondents,
  listCachedCorrespondents,
  loadCachedCorrespondentsRemote,
  rememberCorrespondentMessages,
} from "../src/main/mail/correspondent-cache";
import { runIndexedThreadSearchRemote } from "../src/main/mail/mail-search";

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

const emptyAccountAddresses = (query: string, limit: number) =>
  listCachedCorrespondents(["empty@example.com"], query, limit)?.senders.map(
    ({ address }) => address
  );

describe("mail search", () => {
  beforeAll(() => {
    applyDatabaseMigrations(
      database,
      fileURLToPath(
        new URL("../../../packages/database/drizzle", import.meta.url)
      )
    );
    const insert = connection.prepare(`
      INSERT INTO mail_threads (
        account_id, attachments, from_address, has_attachments, is_in_inbox,
        is_in_sent, is_in_spam, is_in_trash, is_unread, label_ids, latest_at,
        latest_message_id, message_count, snippet, subject, thread_id,
        updated_at
      ) VALUES (?, '[]', ?, 0, ?, 0, ?, 0, ?, ?, ?, 'latest', 1, ?, ?, ?, ?)
    `);

    insert.run(
      "one@example.com",
      "inbox@example.com",
      1,
      0,
      1,
      '["INBOX","u:Important"]',
      2,
      "Inbox thread",
      "Inbox thread",
      "inbox-thread",
      2
    );
    insert.run(
      "one@example.com",
      "archive@example.com",
      0,
      0,
      1,
      '["u:Important"]',
      1,
      "Archived <thread> it's",
      "Archived thread",
      "archived-thread",
      1
    );
    insert.run(
      "one@example.com",
      "spam@example.com",
      0,
      1,
      1,
      '["SPAM","UNREAD"]',
      3,
      "Spam thread",
      "Spam thread",
      "spam-thread",
      3
    );
    const insertMessage = connection.prepare(`
      INSERT INTO mail_messages (
        account_id, bcc_addresses, cc_addresses, from_address, from_name,
        is_draft, is_starred, is_unread, label_ids, message_id, received_at,
        size, subject, thread_id, to_addresses, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, '[]', ?, ?, 1, ?, ?, ?, ?)
    `);

    insertMessage.run(
      "one@example.com",
      '["blind@example.com"]',
      '["copy@example.com"]',
      "alice@example.com",
      "Alice",
      "message-one",
      1,
      "First",
      "message-thread-one",
      '["bob@example.com"]',
      1
    );
    insertMessage.run(
      "one@example.com",
      "[]",
      "[]",
      "alice@example.com",
      "Alice",
      "message-two",
      2,
      "Second",
      "message-thread-two",
      '["bob@example.com"]',
      2
    );
    insertMessage.run(
      "two@example.com",
      "[]",
      "[]",
      "other@example.com",
      "Other",
      "message-three",
      3,
      "Third",
      "message-thread-three",
      '["bob@example.com"]',
      3
    );
    insertMessage.run(
      "one@example.com",
      "[]",
      "[]",
      "spam@example.com",
      "Spam Sender",
      "spam-message",
      3,
      "Spam needle",
      "spam-thread",
      "[]",
      3
    );
  });

  beforeEach(() => forgetCachedCorrespondents());

  afterAll(() => {
    forgetCachedCorrespondents();
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

  it("searches a label by its id, so a folder named Spam is not the Spam mailbox", async () => {
    connection
      .prepare(
        `INSERT INTO mail_threads (
          account_id, attachments, from_address, has_attachments, is_in_inbox,
          is_in_sent, is_in_spam, is_in_trash, is_unread, label_ids, latest_at,
          latest_message_id, message_count, snippet, subject, thread_id,
          updated_at
        ) VALUES ('one@example.com', '[]', 'folder@example.com', 0, 0, 0, 0,
          0, 0, '["u:Spam"]', 4, 'latest', 1, '', 'Filed', 'folder-thread', 4)`
      )
      .run();

    try {
      const folder = await runIndexedThreadSearchRemote(remoteDatabase, {
        accountIds: ["one@example.com"],
        filters: [{ field: "label", value: "u:Spam" }],
      });

      expect(folder.threads.map(({ threadId }) => threadId)).toStrictEqual([
        "folder-thread",
      ]);
    } finally {
      connection
        .prepare("DELETE FROM mail_threads WHERE thread_id = 'folder-thread'")
        .run();
    }
  });

  it("finds starred mail by its system id, and the Starred place's scope leaves Trash out", async () => {
    const insert = connection.prepare(
      `INSERT INTO mail_threads (
        account_id, attachments, from_address, has_attachments, is_in_inbox,
        is_in_sent, is_in_spam, is_in_trash, is_unread, label_ids, latest_at,
        latest_message_id, message_count, snippet, subject, thread_id,
        updated_at
      ) VALUES ('one@example.com', '[]', 'star@example.com', 0, 0, 0, 0,
        ?, 0, ?, ?, 'latest', 1, '', 'Starred', ?, 4)`
    );
    insert.run(0, '["STARRED"]', 7, "starred-thread");
    insert.run(1, '["STARRED","TRASH"]', 6, "trashed-star");
    insert.run(0, '["u:starred"]', 5, "folder-star");

    try {
      const search = async (field: "is" | "label") => {
        const results = await runIndexedThreadSearchRemote(remoteDatabase, {
          accountIds: ["one@example.com"],
          filters: [{ field, value: "starred" }],
        });
        return results.threads.map(({ threadId }) => threadId);
      };

      expect({
        is: await search("is"),
        label: await search("label"),
      }).toStrictEqual({
        is: ["starred-thread", "trashed-star"],
        label: ["starred-thread"],
      });
    } finally {
      connection
        .prepare(
          "DELETE FROM mail_threads WHERE thread_id IN ('starred-thread', 'trashed-star', 'folder-star')"
        )
        .run();
    }
  });

  it("returns snippets as stored, without HTML escaping", async () => {
    const important = await runIndexedThreadSearchRemote(remoteDatabase, {
      accountIds: ["one@example.com"],
      filters: [{ field: "label", value: "important" }],
    });

    expect(
      important.threads.find(({ threadId }) => threadId === "archived-thread")
        ?.snippet
    ).toBe("Archived <thread> it's");
  });

  it("keeps Spam out of default results unless explicitly requested", async () => {
    const defaultResults = await runIndexedThreadSearchRemote(remoteDatabase, {
      accountIds: ["one@example.com"],
    });
    const spam = await runIndexedThreadSearchRemote(remoteDatabase, {
      accountIds: ["one@example.com"],
      filters: [{ field: "label", value: "spam" }],
    });
    const defaultText = await runIndexedThreadSearchRemote(remoteDatabase, {
      accountIds: ["one@example.com"],
      text: "needle",
    });
    const spamText = await runIndexedThreadSearchRemote(remoteDatabase, {
      accountIds: ["one@example.com"],
      filters: [{ field: "label", value: "spam" }],
      text: "needle",
    });

    expect(
      defaultResults.threads.map(({ threadId }) => threadId)
    ).not.toContain("spam-thread");
    expect(spam.threads.map(({ threadId }) => threadId)).toStrictEqual([
      "spam-thread",
    ]);
    expect(defaultText.threads).toStrictEqual([]);
    expect(spamText.threads.map(({ threadId }) => threadId)).toStrictEqual([
      "spam-thread",
    ]);
  });

  it("loads every address field with account isolation", async () => {
    await loadCachedCorrespondentsRemote(remoteDatabase, [
      "one@example.com",
      "two@example.com",
    ]);

    expect(
      listCachedCorrespondents(["one@example.com"], undefined, 10)?.senders.map(
        ({ address }) => address
      )
    ).toStrictEqual([
      "alice@example.com",
      "bob@example.com",
      "blind@example.com",
      "copy@example.com",
    ]);
    expect(
      listCachedCorrespondents(["one@example.com"], "copy", 10)?.senders
    ).toStrictEqual([{ address: "copy@example.com", messageCount: 1 }]);
    expect(
      listCachedCorrespondents(["two@example.com"], "other", 10)?.senders
    ).toStrictEqual([
      { address: "other@example.com", messageCount: 1, name: "Other" },
    ]);
    expect(
      listCachedCorrespondents(["one@example.com"], "other", 10)?.senders
    ).toStrictEqual([]);
  });

  it("does not reload an account already in memory", async () => {
    let queryCount = 0;
    const countingDatabase = createRemoteDatabaseClient(
      (query, parameters, method) => {
        queryCount += 1;
        return executeRemoteQuery(query, parameters, method);
      }
    );

    await loadCachedCorrespondentsRemote(countingDatabase, ["one@example.com"]);
    await loadCachedCorrespondentsRemote(countingDatabase, ["one@example.com"]);

    expect(queryCount).toBe(1);
  });

  it("folds newly indexed addresses into a loaded snapshot", async () => {
    await loadCachedCorrespondentsRemote(remoteDatabase, ["one@example.com"]);

    rememberCorrespondentMessages("one@example.com", [
      {
        bcc: [],
        cc: [],
        from: { address: "new@example.com", name: "New Sender" },
        to: [{ address: "latest@example.com" }],
      },
    ]);

    expect(
      listCachedCorrespondents(["one@example.com"], "new@", 10)?.senders
    ).toStrictEqual([
      { address: "new@example.com", messageCount: 1, name: "New Sender" },
    ]);

    forgetCachedCorrespondents("one@example.com");
    expect(
      listCachedCorrespondents(["one@example.com"], "new@", 10)
    ).toBeUndefined();
  });

  it("matches letters in order and ranks the closest match before the limit", async () => {
    await loadCachedCorrespondentsRemote(remoteDatabase, ["empty@example.com"]);

    rememberCorrespondentMessages("empty@example.com", [
      {
        bcc: [],
        cc: [],
        from: { address: "dana.t@example.com" },
        to: [
          { address: "dt@example.com" },
          { address: "ines@example.com", name: "Dario Toma" },
          { address: "nobody@example.com" },
        ],
      },
    ]);
    expect({
      initials: emptyAccountAddresses("DT", 10),
      limited: emptyAccountAddresses("dt@", 1),
      scattered: emptyAccountAddresses("dt@", 10),
    }).toStrictEqual({
      initials: ["dt@example.com", "dana.t@example.com", "ines@example.com"],
      limited: ["dt@example.com"],
      scattered: ["dt@example.com", "dana.t@example.com"],
    });
  });

  it("keeps the in-memory snapshot bounded per account", async () => {
    await loadCachedCorrespondentsRemote(remoteDatabase, ["empty@example.com"]);

    rememberCorrespondentMessages(
      "empty@example.com",
      Array.from({ length: 10_001 }, (_, index) => ({
        bcc: [],
        cc: [],
        from: { address: `person-${index}@example.com` },
        to: [],
      }))
    );

    expect(
      listCachedCorrespondents(["empty@example.com"], undefined, 12_000)
        ?.senders
    ).toHaveLength(10_000);
  });
});
