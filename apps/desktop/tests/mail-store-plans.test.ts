// Query plans for the store's per-message lookups and updates. Each of these
// once read every copy or message in the account to find a handful, which no
// result-based test notices: the answers were right, only thousands of times
// slower. SQLite plans without statistics here, so an empty database plans as
// a full one does.
// oxlint-disable typescript/no-unsafe-type-assertion
import type { RemoteDatabaseExecute } from "@repo/database/remote-client";
import { createRemoteDatabaseClient } from "@repo/database/remote-client";
import { MailStoreError } from "@repo/mail/errors";
import { LabelId, MessageId, SystemLabel, ThreadId } from "@repo/mail/ids";
import { MailEngineStore } from "@repo/mail/store";
import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MailDatabase } from "../src/main/mail/engine/mail-database";
import {
  readUnreadCounts,
  readUnreadInboxCount,
  readUnreadLabels,
} from "../src/main/mail/engine/mail-reads";
import { MailEngineStoreLive } from "../src/main/mail/engine/mail-store";
import { runIndexedThreadSearchRemote } from "../src/main/mail/mail-search";
import {
  ALL_MAIL,
  accountId,
  connection,
  insertAccount,
  resetDatabase,
} from "./fixtures/mail-engine-harness";

// Search reaches the database through main's client; these tests hand it one.
vi.mock(import("../src/main/database"), () => ({
  withDatabaseClient: vi.fn<() => never>(),
}));

interface Statement {
  readonly params: unknown[];
  readonly sql: string;
}

let statements: Statement[] = [];

const execute: RemoteDatabaseExecute = (sql, params, method) => {
  statements.push({ params, sql });
  const statement = connection.prepare<unknown[], unknown[]>(sql);

  if (method === "run") {
    statement.run(...params);

    return Promise.resolve([]);
  }

  return Promise.resolve(statement.raw(true).all(...params));
};

const remote = createRemoteDatabaseClient(execute);

const Store = MailEngineStoreLive.pipe(
  Layer.provide(
    Layer.succeed(
      MailDatabase,
      MailDatabase.of({
        use: (message, run) =>
          Effect.tryPromise({
            catch: (cause) => new MailStoreError({ cause, message }),
            try: () => run(remote),
          }),
      })
    )
  )
);

/** The plan of every statement `run` sends, one line per step. */
const plansDuring = async <Outcome>(
  run: () => Promise<Outcome>
): Promise<readonly string[]> => {
  statements = [];
  await run();

  return statements
    .filter(({ sql }) => /^\s*(?:with|select|update|delete)\b/iu.test(sql))
    .flatMap(({ params, sql }) =>
      connection
        .prepare<unknown[], { readonly detail: string }>(
          `EXPLAIN QUERY PLAN ${sql}`
        )
        .all(...params)
        .map((row) => row.detail)
    );
};

const plansOf = (
  operate: (
    store: MailEngineStore["Service"]
  ) => Effect.Effect<unknown, unknown>
) =>
  plansDuring(() =>
    Effect.runPromise(
      Effect.gen(function* runStore() {
        yield* operate(yield* MailEngineStore);
      }).pipe(Effect.provide(Store))
    )
  );

/** A step that reads a mail table by its account alone, or all of it. */
const readsWholeAccount = (step: string): boolean =>
  /\((?:account_id=\?)(?: AND mailbox_path=\?)?\)$/u.test(step) ||
  /^SCAN (?:mail_messages|mail_message_locations|mail_threads)\b/u.test(step);

const seed = () => {
  const now = 1_700_000_000_000;
  connection
    .prepare(
      `INSERT INTO mail_messages (account_id, bcc_addresses, cc_addresses,
         from_address, is_draft, is_starred, is_unread, label_ids, message_id,
         received_at, size, subject, thread_id, to_addresses, updated_at)
       VALUES (?, '[]', '[]', 'a@example.com', 0, 0, 0, '["INBOX"]', '1', ?,
         10, 'Subject', 't1', '[]', 0)`
    )
    .run(accountId, now);
  connection
    .prepare(
      `INSERT INTO mail_message_locations (account_id, flags, label_ids,
         mailbox_path, message_id, uid, uid_validity, updated_at)
       VALUES (?, ?, '["INBOX"]', ?, '1', 1, '1', 0)`
    )
    .run(accountId, JSON.stringify(["\\Seen"]), ALL_MAIL);
};

describe("the store's lookups by message", () => {
  beforeEach(() => {
    resetDatabase();
    insertAccount("gmail");
    seed();
  });

  it("finds pending bodies without reading every copy", async () => {
    const plans = await plansOf((store) =>
      Effect.all([
        store.bodyCandidates(accountId, { limit: 25 }),
        store.bodyCandidates(accountId, { limit: 25, receivedAfter: 0 }),
        store.threadBodyCandidates(accountId, ThreadId.make("t1")),
      ])
    );

    expect(plans.filter(readsWholeAccount)).toStrictEqual([]);
  });

  it("finds a conversation's copies without reading every copy", async () => {
    const plans = await plansOf((store) =>
      store.threadLocations(accountId, [ThreadId.make("t1")])
    );

    expect(plans.filter(readsWholeAccount)).toStrictEqual([]);
  });

  // Runs for every account each time the engine starts.
  it("finds conversations to list again from what Trash and Spam hold", async () => {
    const plans = await plansOf((store) => store.relistHidden(accountId));

    // Two reads are of a whole something, and both are small: the account's
    // mailboxes, to find Trash and Spam, and the copies those two hold. A
    // message's other copies are then reached by its id.
    expect(plans.filter(readsWholeAccount)).toStrictEqual([
      "SEARCH mail_mailboxes USING INDEX sqlite_autoindex_mail_mailboxes_1 (account_id=?)",
      "SEARCH mail_message_locations USING INDEX sqlite_autoindex_mail_message_locations_1 (account_id=? AND mailbox_path=?)",
    ]);
    expect(plans.join("\n")).toMatch(
      /SEARCH other EXISTS USING INDEX mail_message_locations_message_idx/u
    );
    expect(plans.join("\n")).toMatch(/mail_threads_trash_idx/u);
    expect(plans.join("\n")).toMatch(/mail_threads_spam_idx/u);
  });

  it("updates changed copies and their messages by key", async () => {
    const plans = await plansOf((store) =>
      store.applyLocationChanges(
        accountId,
        ALL_MAIL,
        [
          {
            flags: [],
            labelIds: [SystemLabel.inbox, LabelId.make(SystemLabel.unread)],
            modseq: 2n,
            uid: 1,
          },
        ],
        {}
      )
    );

    expect(plans.some((step) => step.includes("uid=?"))).toBeTruthy();
    expect(plans.filter(readsWholeAccount)).toStrictEqual([]);
  });

  it("records a new mod-sequence by key", async () => {
    const plans = await plansOf((store) =>
      store.applyLocationChanges(
        accountId,
        ALL_MAIL,
        [
          {
            flags: ["\\Seen"],
            labelIds: [SystemLabel.inbox],
            modseq: 3n,
            uid: 1,
          },
        ],
        {}
      )
    );

    expect(plans.filter(readsWholeAccount)).toStrictEqual([]);
  });

  it("removes copies and recomputes their messages by key", async () => {
    const plans = await plansOf((store) =>
      Effect.all([
        store.removeLocations(accountId, ALL_MAIL, [1]),
        store.removeMessagesWithoutCopies(accountId, [MessageId.make("1")]),
      ])
    );

    expect(plans.filter(readsWholeAccount)).toStrictEqual([]);
  });
});

describe("the list's counts and sender search", () => {
  beforeEach(() => {
    resetDatabase();
    insertAccount("gmail");
    seed();
  });

  it("counts unread Inbox mail from the unread index", async () => {
    const plans = await plansDuring(() => readUnreadInboxCount(remote));

    // The index holds only unread mail outside Spam and Trash, so reading all
    // of it is reading what is counted.
    expect(plans).toStrictEqual([
      "SCAN mail_threads USING INDEX mail_threads_unread_idx",
    ]);
  });

  it("counts an account's unread Inbox mail from the unread index", async () => {
    const plans = await plansDuring(() =>
      readUnreadCounts(remote, [accountId])
    );

    expect(plans.join("\n")).toContain(
      "SEARCH mail_threads USING INDEX mail_threads_unread_idx (account_id=? AND is_in_inbox=?)"
    );
    expect(plans.filter(readsWholeAccount)).toStrictEqual([]);
  });

  it("finds labels with unread mail from the unread index", async () => {
    const plans = await plansDuring(() =>
      readUnreadLabels(remote, [accountId])
    );

    expect(plans.join("\n")).toContain("mail_threads_unread_idx");
  });

  it("reads only the threads a text search matched", async () => {
    const plans = await plansDuring(() =>
      runIndexedThreadSearchRemote(remote, {
        accountIds: [accountId],
        text: "subject",
      })
    );

    expect(plans).toContain("SCAN matched");
    expect(plans.filter(readsWholeAccount)).toStrictEqual([]);
  });

  it("matches senders without reading messages", async () => {
    const plans = await plansDuring(() =>
      runIndexedThreadSearchRemote(remote, {
        accountIds: [accountId],
        filters: [{ field: "from", value: "example" }],
      })
    );

    expect(plans.join("\n")).toContain("COVERING INDEX mail_messages_from_idx");
  });
});
