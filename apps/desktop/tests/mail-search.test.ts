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
import {
  runIndexedThreadSearch,
  runSenderSuggestions,
} from "../src/main/mail/mail-search";

const ACCOUNT = "user@example.com";
const OTHER_ACCOUNT = "second@example.com";

const migrationsFolder = fileURLToPath(
  new URL("../../../packages/database/drizzle", import.meta.url)
);
const temporaryDirectories: string[] = [];

interface SeedMessage {
  account?: string;
  body: string;
  from: string;
  fromName?: string;
  hasAttachments?: boolean;
  isUnread?: boolean;
  labels?: readonly string[];
  sentAt: number;
  subject: string;
  threadId: string;
  to?: readonly string[];
}

const MESSAGES: readonly SeedMessage[] = [
  {
    body: "The invoice for March is attached, thanks.",
    from: "jane@example.com",
    fromName: "Jane Doe",
    hasAttachments: true,
    sentAt: 300,
    subject: "March invoice",
    threadId: "t-invoice",
    to: ["user@example.com"],
  },
  {
    body: "Re: the invoice — paid it this morning.",
    from: "user@example.com",
    sentAt: 350,
    subject: "March invoice",
    threadId: "t-invoice",
    to: ["jane@example.com"],
  },
  {
    body: "Lunch on Friday? No invoice talk, promise.",
    from: "jane@example.com",
    fromName: "Jane Doe",
    isUnread: true,
    labels: ["INBOX"],
    sentAt: 200,
    subject: "Lunch",
    threadId: "t-lunch",
    to: ["user@example.com"],
  },
  {
    body: "Your parcel is on its way.",
    from: "noreply@shipping.example",
    sentAt: 100,
    subject: "Shipping update",
    threadId: "t-shipping",
    to: ["user@example.com"],
  },
  {
    account: OTHER_ACCOUNT,
    body: "An invoice on the other account entirely.",
    from: "billing@other.example",
    sentAt: 400,
    subject: "Other invoice",
    threadId: "t-other",
    to: ["second@example.com"],
  },
];

const createIndexedDatabase = (messages: readonly SeedMessage[] = MESSAGES) => {
  const directory = mkdtempSync(path.join(tmpdir(), "kisa-search-"));
  const connection = openDatabaseConnection(path.join(directory, "app.sqlite"));

  temporaryDirectories.push(directory);

  const database = createDatabaseClient(connection);

  applyDatabaseMigrations(database, migrationsFolder);

  const insertThread = connection.prepare(`
    INSERT INTO gmail_threads (
      account_email, "from", has_attachments, is_in_inbox, is_unread, labels,
      latest_at, message_count, snippet, subject, thread_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT (account_email, thread_id) DO UPDATE SET
      latest_at = max(excluded.latest_at, gmail_threads.latest_at)
  `);
  const insertMessage = connection.prepare(`
    INSERT INTO gmail_messages (
      account_email, body_text, from_address, from_name, internal_date,
      message_id, schema_version, subject, thread_id, to_addresses, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 1)
  `);

  for (const [index, message] of messages.entries()) {
    const account = message.account ?? ACCOUNT;

    insertThread.run(
      account,
      message.from,
      message.hasAttachments === true ? 1 : 0,
      1,
      message.isUnread === true ? 1 : 0,
      JSON.stringify(message.labels ?? ["INBOX"]),
      message.sentAt,
      1,
      message.body.slice(0, 20),
      message.subject,
      message.threadId
    );
    insertMessage.run(
      account,
      message.body,
      message.from,
      message.fromName ?? null,
      message.sentAt,
      `m-${index}`,
      message.subject,
      message.threadId,
      JSON.stringify(message.to ?? [])
    );
  }

  return { connection, database };
};

const searchThreadIds = (
  database: ReturnType<typeof createIndexedDatabase>["database"],
  request: Parameters<typeof runIndexedThreadSearch>[1]
): readonly string[] =>
  runIndexedThreadSearch(database, request).threads.map(
    (thread) => thread.threadId
  );

describe("indexed mail search", () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("finds threads by words in any of their messages", () => {
    const { connection, database } = createIndexedDatabase();

    try {
      expect(
        searchThreadIds(database, { accountIds: [ACCOUNT], text: "invoice" })
      ).toStrictEqual(["t-invoice", "t-lunch"]);
    } finally {
      connection.close();
    }
  });

  it("matches a word that is still being typed", () => {
    const { connection, database } = createIndexedDatabase();

    try {
      expect(
        searchThreadIds(database, { accountIds: [ACCOUNT], text: "invoi" })
      ).toStrictEqual(["t-invoice", "t-lunch"]);
    } finally {
      connection.close();
    }
  });

  it("stays inside the accounts it was asked about", () => {
    const { connection, database } = createIndexedDatabase();

    try {
      expect(
        [
          ...searchThreadIds(database, {
            accountIds: [ACCOUNT, OTHER_ACCOUNT],
            text: "invoice",
          }),
        ].toSorted()
      ).toStrictEqual(["t-invoice", "t-lunch", "t-other"]);
      expect(
        searchThreadIds(database, {
          accountIds: [OTHER_ACCOUNT],
          text: "invoice",
        })
      ).toStrictEqual(["t-other"]);
    } finally {
      connection.close();
    }
  });

  it("narrows to a sender, by address or by display name", () => {
    const { connection, database } = createIndexedDatabase();

    try {
      expect(
        searchThreadIds(database, {
          accountIds: [ACCOUNT],
          filters: [{ field: "from", value: "jane@example.com" }],
        })
      ).toStrictEqual(["t-invoice", "t-lunch"]);
      expect(
        searchThreadIds(database, {
          accountIds: [ACCOUNT],
          filters: [{ field: "from", value: "Jane" }],
        })
      ).toStrictEqual(["t-invoice", "t-lunch"]);
    } finally {
      connection.close();
    }
  });

  it("combines operators with the text to match", () => {
    const { connection, database } = createIndexedDatabase();

    try {
      expect(
        searchThreadIds(database, {
          accountIds: [ACCOUNT],
          filters: [{ field: "from", value: "jane@example.com" }],
          text: "lunch",
        })
      ).toStrictEqual(["t-lunch"]);
    } finally {
      connection.close();
    }
  });

  it("narrows to a subject, anywhere in it", () => {
    const { connection, database } = createIndexedDatabase();

    try {
      expect(
        searchThreadIds(database, {
          accountIds: [ACCOUNT],
          filters: [{ field: "subject", value: "invoice" }],
        })
      ).toStrictEqual(["t-invoice"]);
      // The body of `t-lunch` says "invoice", its subject does not.
      expect(
        searchThreadIds(database, {
          accountIds: [ACCOUNT],
          filters: [{ field: "subject", value: "lunc" }],
        })
      ).toStrictEqual(["t-lunch"]);
    } finally {
      connection.close();
    }
  });

  it("filters on recipients, attachments and read state", () => {
    const { connection, database } = createIndexedDatabase();

    try {
      expect(
        searchThreadIds(database, {
          accountIds: [ACCOUNT],
          filters: [{ field: "to", value: "jane@example.com" }],
        })
      ).toStrictEqual(["t-invoice"]);
      expect(
        searchThreadIds(database, {
          accountIds: [ACCOUNT],
          filters: [{ field: "has", value: "attachment" }],
        })
      ).toStrictEqual(["t-invoice"]);
      expect(
        searchThreadIds(database, {
          accountIds: [ACCOUNT],
          filters: [{ field: "is", value: "unread" }],
        })
      ).toStrictEqual(["t-lunch"]);
    } finally {
      connection.close();
    }
  });

  it("ranks a subject match over a newer message that only mentions it", () => {
    const { connection, database } = createIndexedDatabase([
      {
        body: "Nothing much to say here.",
        from: "billing@example.com",
        sentAt: 10,
        subject: "Invoice 2019",
        threadId: "t-subject-hit",
      },
      {
        body: "Great weekend — we can sort the invoice out on Monday.",
        from: "friend@example.com",
        sentAt: 900,
        subject: "Weekend",
        threadId: "t-body-hit",
      },
    ]);

    try {
      expect(
        searchThreadIds(database, { accountIds: [ACCOUNT], text: "invoice" })
      ).toStrictEqual(["t-subject-hit", "t-body-hit"]);
    } finally {
      connection.close();
    }
  });

  it("orders by date when the query is filters alone", () => {
    const { connection, database } = createIndexedDatabase();

    try {
      expect(
        searchThreadIds(database, {
          accountIds: [ACCOUNT],
          filters: [{ field: "from", value: "jane@example.com" }],
        })
      ).toStrictEqual(["t-invoice", "t-lunch"]);
    } finally {
      connection.close();
    }
  });

  it("reports when more matched than were returned", () => {
    const { connection, database } = createIndexedDatabase();

    try {
      const results = runIndexedThreadSearch(database, {
        accountIds: [ACCOUNT],
        limit: 1,
        text: "invoice",
      });

      expect(results.threads).toHaveLength(1);
      expect(results.hasMore).toBeTruthy();
    } finally {
      connection.close();
    }
  });

  it("keeps punctuation out of the FTS query", () => {
    const { connection, database } = createIndexedDatabase();

    try {
      expect(
        searchThreadIds(database, {
          accountIds: [ACCOUNT],
          text: '"Re: (invoice)"',
        })
      ).toStrictEqual(["t-invoice"]);
    } finally {
      connection.close();
    }
  });
});

describe(runSenderSuggestions, () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("ranks the senders of an account by how much they have sent", () => {
    const { connection, database } = createIndexedDatabase();

    try {
      expect(
        runSenderSuggestions(database, { accountIds: [ACCOUNT] }).senders
      ).toStrictEqual([
        { address: "jane@example.com", messageCount: 2, name: "Jane Doe" },
        { address: "noreply@shipping.example", messageCount: 1 },
        { address: "user@example.com", messageCount: 1 },
      ]);
    } finally {
      connection.close();
    }
  });

  it("completes recipients from this account's sent mail", () => {
    const { connection, database } = createIndexedDatabase();

    try {
      expect(
        runSenderSuggestions(database, {
          accountIds: [ACCOUNT],
          role: "recipient",
        }).senders
      ).toStrictEqual([{ address: "jane@example.com", messageCount: 1 }]);
      expect(
        runSenderSuggestions(database, {
          accountIds: [ACCOUNT],
          query: "nobody",
          role: "recipient",
        }).senders
      ).toStrictEqual([]);
    } finally {
      connection.close();
    }
  });

  it("ranks correspondents from both sides of existing messages", () => {
    const { connection, database } = createIndexedDatabase();

    try {
      expect(
        runSenderSuggestions(database, {
          accountIds: [ACCOUNT],
          query: "jan",
          role: "correspondent",
        }).senders
      ).toStrictEqual([
        { address: "jane@example.com", messageCount: 3, name: "Jane Doe" },
      ]);
      expect(
        runSenderSuggestions(database, {
          accountIds: [OTHER_ACCOUNT],
          role: "correspondent",
        }).senders.map((sender) => sender.address)
      ).toStrictEqual(["billing@other.example", "second@example.com"]);
    } finally {
      connection.close();
    }
  });

  it("completes on the address or on the display name", () => {
    const { connection, database } = createIndexedDatabase();

    try {
      expect(
        runSenderSuggestions(database, {
          accountIds: [ACCOUNT],
          query: "jan",
        }).senders.map((sender) => sender.address)
      ).toStrictEqual(["jane@example.com"]);
      expect(
        runSenderSuggestions(database, {
          accountIds: [ACCOUNT],
          query: "shipping",
        }).senders.map((sender) => sender.address)
      ).toStrictEqual(["noreply@shipping.example"]);
    } finally {
      connection.close();
    }
  });
});
