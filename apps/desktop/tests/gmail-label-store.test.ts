// oxlint-disable typescript/no-unsafe-type-assertion
import { fileURLToPath } from "node:url";

import {
  applyDatabaseMigrations,
  createDatabaseClient,
  openDatabaseConnection,
} from "@repo/database/client";
import type {
  DatabaseRemoteCallback,
  RemoteDatabaseClient,
} from "@repo/database/remote-client";
import { createRemoteDatabaseClient } from "@repo/database/remote-client";
import {
  AccountId,
  GmailLabel,
  LabelColor,
  LabelId,
  MessageId,
  ThreadId,
  ThreadSummary,
} from "@repo/gmail/models";
import { GmailStore } from "@repo/gmail/store";
import { Effect } from "effect";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { getGoogleAccessToken } from "../src/main/auth/auth";
import type { withDatabaseClient } from "../src/main/database";
import { GmailStoreLive } from "../src/main/mail/gmail-store";

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

const remoteDatabase = createRemoteDatabaseClient(executeRemoteQuery);

vi.mock(import("../src/main/database"), async () => {
  const { DatabaseError } = await import("@repo/database/runtime");
  const { Effect: EffectModule } = await import("effect");
  const useTestDatabase = (<A>(
    run: (database: RemoteDatabaseClient) => Promise<A>
  ) =>
    EffectModule.tryPromise({
      catch: (cause) => DatabaseError.new({ cause, reason: "query" }),
      try: () => run(remoteDatabase),
    })) as typeof withDatabaseClient;

  return { withDatabaseClient: useTestDatabase };
});

vi.mock(import("../src/main/auth/auth"), () => ({
  getGoogleAccessToken: vi.fn<typeof getGoogleAccessToken>(),
}));

describe("Gmail label store", () => {
  beforeEach(() => {
    connection.prepare("DELETE FROM gmail_messages").run();
    connection.prepare("DELETE FROM gmail_threads").run();
    connection.prepare("DELETE FROM gmail_labels").run();
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(() => connection.close());

  it("persists and restores optional label colors", async () => {
    const accountId = AccountId.make("person@example.com");
    const colored = new GmailLabel({
      color: new LabelColor({ background: "#16a766", text: "#ffffff" }),
      id: LabelId.make("Label_1"),
      name: "Receipts",
      type: "user",
    });
    const uncolored = new GmailLabel({
      id: LabelId.make("INBOX"),
      name: "INBOX",
      type: "system",
    });

    const labels = await Effect.runPromise(
      Effect.gen(function* persistAndLoadLabels() {
        const store = yield* GmailStore;
        yield* store.replaceLabels(accountId, [colored, uncolored]);
        return yield* store.getLabels(accountId);
      }).pipe(Effect.provide(GmailStoreLive))
    );

    expect(labels).toHaveLength(2);
    expect(labels.find((label) => label.id === colored.id)).toStrictEqual(
      colored
    );
    expect(labels.find((label) => label.id === uncolored.id)).toStrictEqual(
      uncolored
    );
    expect(
      connection
        .prepare(
          `SELECT background_color, label_id, text_color
           FROM gmail_labels
           ORDER BY label_id`
        )
        .all()
    ).toStrictEqual([
      {
        background_color: null,
        label_id: "INBOX",
        text_color: null,
      },
      {
        background_color: "#16a766",
        label_id: "Label_1",
        text_color: "#ffffff",
      },
    ]);
  });

  it("upserts newly discovered labels without replacing the catalog", async () => {
    const accountId = AccountId.make("person@example.com");
    const inbox = new GmailLabel({
      id: LabelId.make("INBOX"),
      name: "INBOX",
      type: "system",
    });
    const updated = new GmailLabel({
      color: new LabelColor({ background: "#16a766", text: "#ffffff" }),
      id: LabelId.make("Label_1"),
      name: "Updated label",
      type: "user",
    });
    const discovered = new GmailLabel({
      color: new LabelColor({ background: "#4a86e8", text: "#ffffff" }),
      id: LabelId.make("Label_2"),
      name: "Discovered label",
      type: "user",
    });

    const labels = await Effect.runPromise(
      Effect.gen(function* upsertAndLoadLabels() {
        const store = yield* GmailStore;
        yield* store.replaceLabels(accountId, [
          inbox,
          new GmailLabel({
            id: updated.id,
            name: "Old label",
            type: "user",
          }),
        ]);
        yield* store.upsertLabels(accountId, [updated, discovered]);
        return yield* store.getLabels(accountId);
      }).pipe(Effect.provide(GmailStoreLive))
    );

    expect(
      labels.toSorted((left, right) => left.id.localeCompare(right.id))
    ).toStrictEqual([inbox, updated, discovered]);
  });

  it("reconciles cached labels by id without crossing accounts", async () => {
    const accountId = AccountId.make("person@example.com");
    const otherAccountId = "other@example.com";
    const threadId = ThreadId.make("shared-thread");
    const label = new GmailLabel({
      id: LabelId.make("Label_1"),
      name: "Receipts",
      type: "user",
    });
    const insertThread = connection.prepare(
      `INSERT INTO gmail_threads (
         account_email, "from", is_in_inbox, is_unread, labels, latest_at,
         message_count, snippet, subject, thread_id, updated_at
       ) VALUES (?, 'sender@example.com', 1, 0, ?, 1, 1, '',
         'Subject', 'shared-thread', 1)`
    );
    const insertMessage = connection.prepare(
      `INSERT INTO gmail_messages (
         account_email, from_address, internal_date, label_ids, message_id,
         schema_version, subject, thread_id, updated_at
       ) VALUES (?, 'sender@example.com', 1, ?, ?, 1, 'Subject',
         'shared-thread', 1)`
    );
    const setLabel = (applied: boolean) =>
      Effect.runPromise(
        GmailStore.pipe(
          Effect.flatMap((store) =>
            store.setThreadLabel(accountId, threadId, label, applied)
          ),
          Effect.provide(GmailStoreLive)
        )
      );

    insertThread.run(accountId, '["INBOX","Old receipts"]');
    insertThread.run(otherAccountId, '["INBOX"]');
    insertMessage.run(accountId, '["INBOX","Label_1"]', "message-a");
    insertMessage.run(otherAccountId, '["INBOX"]', "message-b");

    await setLabel(false);

    expect(
      connection
        .prepare(
          `SELECT account_email, labels
           FROM gmail_threads
           ORDER BY account_email`
        )
        .all()
    ).toStrictEqual([
      { account_email: otherAccountId, labels: '["INBOX"]' },
      { account_email: accountId, labels: '["INBOX"]' },
    ]);
    expect(
      connection
        .prepare(
          `SELECT account_email, label_ids
           FROM gmail_messages
           ORDER BY account_email`
        )
        .all()
    ).toStrictEqual([
      { account_email: otherAccountId, label_ids: '["INBOX"]' },
      { account_email: accountId, label_ids: '["INBOX"]' },
    ]);

    await setLabel(true);

    expect(
      connection
        .prepare(
          `SELECT labels
           FROM gmail_threads
           WHERE account_email = ? AND thread_id = 'shared-thread'`
        )
        .get(accountId)
    ).toStrictEqual({ labels: '["INBOX","Receipts"]' });
    expect(
      connection
        .prepare(
          `SELECT label_ids
           FROM gmail_messages
           WHERE account_email = ? AND message_id = 'message-a'`
        )
        .get(accountId)
    ).toStrictEqual({ label_ids: '["INBOX","Label_1"]' });
  });

  it("moves a Spam thread and all cached messages back to Inbox", async () => {
    const accountId = AccountId.make("person@example.com");
    const otherAccountId = AccountId.make("other@example.com");
    const threadId = ThreadId.make("spam-thread");
    const insertThread = connection.prepare(
      `INSERT INTO gmail_threads (
        account_email, "from", is_in_inbox, is_in_spam, is_unread, labels,
        latest_at, message_count, snippet, spam_added_at, subject, thread_id,
        updated_at
      ) VALUES (?, 'sender@example.com', 0, 1, 1, '["SPAM","UNREAD"]',
        1, ?, '', 1, 'Subject', ?, 1)`
    );
    const insertMessage = connection.prepare(
      `INSERT INTO gmail_messages (
        account_email, from_address, internal_date, label_ids, message_id,
        schema_version, subject, thread_id, updated_at
      ) VALUES (?, 'sender@example.com', 1, '["SPAM","UNREAD"]',
        ?, 1, 'Subject', ?, 1)`
    );

    insertThread.run(accountId, 2, threadId);
    insertThread.run(otherAccountId, 1, threadId);
    insertMessage.run(accountId, "spam-message-1", threadId);
    insertMessage.run(accountId, "spam-message-2", threadId);
    insertMessage.run(otherAccountId, "other-message", threadId);

    await Effect.runPromise(
      GmailStore.pipe(
        Effect.flatMap((store) => store.markThreadNotSpam(accountId, threadId)),
        Effect.provide(GmailStoreLive)
      )
    );

    expect(
      connection
        .prepare(
          `SELECT is_in_inbox, is_in_spam, labels, spam_added_at
           FROM gmail_threads
           WHERE account_email = ? AND thread_id = ?`
        )
        .get(accountId, threadId)
    ).toStrictEqual({
      is_in_inbox: 1,
      is_in_spam: 0,
      labels: '["UNREAD","INBOX"]',
      spam_added_at: null,
    });
    expect(
      connection
        .prepare(
          `SELECT label_ids, message_id
           FROM gmail_messages
           WHERE account_email = ? AND thread_id = ?
           ORDER BY message_id ASC`
        )
        .all(accountId, threadId)
    ).toStrictEqual([
      { label_ids: '["UNREAD","INBOX"]', message_id: "spam-message-1" },
      { label_ids: '["UNREAD","INBOX"]', message_id: "spam-message-2" },
    ]);
    expect(
      connection
        .prepare(
          `SELECT is_in_inbox, is_in_spam, labels
           FROM gmail_threads
           WHERE account_email = ? AND thread_id = ?`
        )
        .get(otherAccountId, threadId)
    ).toStrictEqual({
      is_in_inbox: 0,
      is_in_spam: 1,
      labels: '["SPAM","UNREAD"]',
    });
    expect(
      connection
        .prepare(
          `SELECT label_ids
           FROM gmail_messages
           WHERE account_email = ? AND message_id = 'other-message'`
        )
        .get(otherAccountId)
    ).toStrictEqual({ label_ids: '["SPAM","UNREAD"]' });
  });

  it("timestamps only transitions into Spam", async () => {
    const accountId = AccountId.make("person@example.com");
    const threadId = ThreadId.make("spam-transition");
    const now = vi.spyOn(Date, "now");
    const upsert = (labels: readonly LabelId[]) =>
      Effect.runPromise(
        GmailStore.pipe(
          Effect.flatMap((store) =>
            store.upsertThreadDetails(
              accountId,
              [
                new ThreadSummary({
                  attachments: [],
                  hasAttachments: false,
                  hasUnread: true,
                  id: threadId,
                  labelIds: labels,
                  latestAt: "1000",
                  latestMessageId: MessageId.make("message-1"),
                  messageCount: 1,
                  participants: [],
                  snippet: "Snippet",
                  subject: "Subject",
                }),
              ],
              []
            )
          ),
          Effect.provide(GmailStoreLive)
        )
      );
    const readTransition = () =>
      connection
        .prepare(
          `SELECT is_in_spam, spam_added_at
           FROM gmail_threads
           WHERE account_email = ? AND thread_id = ?`
        )
        .get(accountId, threadId);

    now.mockReturnValue(100);
    await upsert([LabelId.make("SPAM"), LabelId.make("UNREAD")]);
    expect(readTransition()).toStrictEqual({
      is_in_spam: 1,
      spam_added_at: 100,
    });

    now.mockReturnValue(200);
    await upsert([LabelId.make("SPAM"), LabelId.make("UNREAD")]);
    expect(readTransition()).toStrictEqual({
      is_in_spam: 1,
      spam_added_at: 100,
    });

    now.mockReturnValue(300);
    await upsert([LabelId.make("INBOX"), LabelId.make("UNREAD")]);
    expect(readTransition()).toStrictEqual({
      is_in_spam: 0,
      spam_added_at: null,
    });

    now.mockReturnValue(400);
    await upsert([LabelId.make("SPAM"), LabelId.make("UNREAD")]);
    expect(readTransition()).toStrictEqual({
      is_in_spam: 1,
      spam_added_at: 400,
    });
  });
});
