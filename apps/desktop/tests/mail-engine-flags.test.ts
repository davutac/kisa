// oxlint-disable typescript/no-unsafe-type-assertion
// Flags changed by another client, on servers with and without CONDSTORE.
import { genericDialect } from "@repo/mail/dialects";
import { ThreadId } from "@repo/mail/ids";
import { applyThreadAction } from "@repo/mail/mutations";
import { FLAG_HEAD_SIZE, FLAG_SLICE_SIZE, syncAccount } from "@repo/mail/sync";
import type { SyncScope } from "@repo/mail/sync";
import { beforeEach, describe, expect, it } from "vitest";

import { FakeImapServer } from "./fixtures/fake-imap-server";
import {
  ICLOUD_MAILBOXES,
  OUTLOOK_CAPABILITIES,
  OUTLOOK_MAILBOXES,
  connection,
  genericMessage,
  insertAccount,
  resetDatabase,
  run,
  scopeFor,
  syncFully,
} from "./fixtures/mail-engine-harness";

interface CachedMessage {
  readonly is_unread: number;
  readonly message_id: string;
  readonly thread_id: string;
}

const cached = (subject: string) =>
  connection
    .prepare(
      "SELECT message_id, thread_id, is_unread FROM mail_messages WHERE subject = ?"
    )
    .get(subject) as CachedMessage | undefined;

/** An Outlook-like account whose Inbox holds `count` unread messages m1… */
const syncOutlookInbox = async (count: number) => {
  insertAccount("generic", "outlook");
  const server = new FakeImapServer(OUTLOOK_MAILBOXES, OUTLOOK_CAPABILITIES);
  for (let index = 1; index <= count; index += 1) {
    server.deliver("INBOX", genericMessage(`m${index}`, { flags: [] }));
  }
  const scope = scopeFor(server, genericDialect);
  await syncFully(scope);
  return { scope, server };
};

const pass = (scope: SyncScope) => run(syncAccount(scope));

/** Counts every row written to the cached copies, messages and threads. */
const countCacheWrites = () => {
  connection.exec("CREATE TEMP TABLE IF NOT EXISTS cache_writes (n INTEGER)");
  connection.exec("DELETE FROM cache_writes");
  const triggers = ["mail_message_locations", "mail_messages", "mail_threads"]
    .flatMap((table) =>
      ["INSERT", "UPDATE", "DELETE"].map((operation) => ({ operation, table }))
    )
    .map(({ operation, table }) => {
      const name = `count_${table}_${operation.toLowerCase()}`;
      connection.exec(
        `CREATE TEMP TRIGGER ${name} AFTER ${operation} ON ${table}
         BEGIN INSERT INTO cache_writes VALUES (1); END`
      );
      return name;
    });

  return {
    stop: () => {
      for (const name of triggers) {
        connection.exec(`DROP TRIGGER ${name}`);
      }
    },
    writes: () =>
      (
        connection
          .prepare("SELECT count(*) AS count FROM cache_writes")
          .get() as { count: number }
      ).count,
  };
};

// The oldest copy is outside the newest FLAG_HEAD_SIZE and two full slices.
const LARGE_INBOX = FLAG_HEAD_SIZE + 2 * FLAG_SLICE_SIZE + 1;
// Read by the second slice: below the first slice, above the oldest copy.
const SECOND_SLICE_UID = LARGE_INBOX - FLAG_HEAD_SIZE - FLAG_SLICE_SIZE - 1;

describe("flags changed elsewhere, without CONDSTORE", () => {
  beforeEach(resetDatabase);

  it("picks up a message read in another client on the next pass", async () => {
    const { scope, server } = await syncOutlookInbox(3);
    expect(cached("m2")).toMatchObject({ is_unread: 1 });
    server.fetches.splice(0);

    server.setFlags("INBOX", 2, ["\\Seen"]);
    const changes = await pass(scope);

    expect(cached("m2")).toMatchObject({ is_unread: 0 });
    expect(changes.changed).toStrictEqual([cached("m2")?.thread_id]);
    // Flags only: no Gmail fields asked of a server that is not Gmail.
    expect(
      server.fetches
        .filter((fetch) => fetch.path === "INBOX")
        .map((fetch) => fetch.fields)
    ).toStrictEqual([{ flags: true, gmail: false }]);
  });

  it("writes and publishes nothing when nothing changed", async () => {
    insertAccount("generic", "outlook");
    const server = new FakeImapServer(OUTLOOK_MAILBOXES, OUTLOOK_CAPABILITIES);
    server.deliver("INBOX", genericMessage("a", { flags: [] }));
    const recent = server.deliver(
      "INBOX",
      genericMessage("b", { flags: ["\\Seen", "\\Recent"] })
    );
    const scope = scopeFor(server, genericDialect);
    await syncFully(scope);
    // `\Recent` is shown to one connection only; the next does not see it.
    server.setFlags("INBOX", recent, ["\\Seen"]);

    const counter = countCacheWrites();
    try {
      await expect(pass(scope)).resolves.toStrictEqual({
        changed: [],
        removed: [],
      });
      expect(counter.writes()).toBe(0);

      server.setFlags("INBOX", 1, ["\\Seen"]);
      await expect(pass(scope)).resolves.toMatchObject({
        changed: [cached("a")?.thread_id],
      });
      expect(counter.writes()).toBeGreaterThan(0);
    } finally {
      counter.stop();
    }
  });

  it("reaches the oldest cached copy within a bounded number of passes", async () => {
    const { scope, server } = await syncOutlookInbox(LARGE_INBOX);
    server.setFlags("INBOX", 1, ["\\Seen"]);

    await pass(scope);
    await pass(scope);
    expect(cached("m1")).toMatchObject({ is_unread: 1 });

    await pass(scope);
    expect(cached("m1")).toMatchObject({ is_unread: 0 });
  });

  it("goes on after a restart where the last pass stopped", async () => {
    const { scope, server } = await syncOutlookInbox(LARGE_INBOX);
    await pass(scope);

    server.setFlags("INBOX", SECOND_SLICE_UID, ["\\Seen"]);
    // A new connection and a new store read the cursor back from the cache.
    await pass(scopeFor(server, genericDialect));

    expect(cached(`m${SECOND_SLICE_UID}`)).toMatchObject({ is_unread: 0 });
  });

  it("reads a slice again when the pass reading it was cut short", async () => {
    const { scope, server } = await syncOutlookInbox(LARGE_INBOX);
    await pass(scope);
    server.setFlags("INBOX", SECOND_SLICE_UID, ["\\Seen"]);

    server.dropFetch = (path, selection) =>
      path === "INBOX" &&
      selection.kind === "range" &&
      selection.from <= SECOND_SLICE_UID &&
      (selection.to ?? Number.POSITIVE_INFINITY) >= SECOND_SLICE_UID;
    await expect(pass(scope)).rejects.toMatchObject({
      _tag: "MailConnectionError",
    });
    expect(cached(`m${SECOND_SLICE_UID}`)).toMatchObject({ is_unread: 1 });

    server.dropFetch = undefined;
    await pass(scope);
    expect(cached(`m${SECOND_SLICE_UID}`)).toMatchObject({ is_unread: 0 });
  });

  it("finds a deletion even when a new message arrived in the same pass", async () => {
    const { scope, server } = await syncOutlookInbox(3);
    const deleted = cached("m2");

    server.expunge("INBOX", 2);
    server.deliver("INBOX", genericMessage("m4", { flags: [] }));
    const changes = await pass(scope);

    expect(cached("m2")).toBeUndefined();
    expect(changes.removed).toStrictEqual([deleted?.thread_id]);
    expect(changes.arrived).toStrictEqual([cached("m4")?.message_id]);
  });

  it("leaves flags to the next pass after the user's own change", async () => {
    const { scope, server } = await syncOutlookInbox(3);
    server.fetches.splice(0);

    await run(
      applyThreadAction(scope, [ThreadId.make(cached("m2")?.thread_id ?? "")], {
        kind: "trash",
      })
    );

    // Only the moved copy is read, from Deleted Items.
    expect(server.fetches.map((fetch) => fetch.path)).toStrictEqual([
      "Deleted Items",
    ]);
  });
});

describe("flags changed elsewhere, with CONDSTORE", () => {
  beforeEach(resetDatabase);

  it("asks only for changes since the stored mod-sequence", async () => {
    insertAccount("generic");
    const server = new FakeImapServer(ICLOUD_MAILBOXES, ["CONDSTORE", "IDLE"]);
    server.deliver("INBOX", genericMessage("a", { flags: [] }));
    const scope = scopeFor(server, genericDialect);
    await syncFully(scope);
    server.fetches.splice(0);

    await pass(scope);
    expect(server.fetches).toStrictEqual([]);

    server.setFlags("INBOX", 1, ["\\Seen"]);
    await pass(scope);
    expect(server.fetches).toMatchObject([
      { changedSince: expect.any(BigInt), path: "INBOX" },
    ]);
    expect(cached("a")).toMatchObject({ is_unread: 0 });
  });
});
